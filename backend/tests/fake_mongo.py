"""Tiny in-memory stand-in for the async Mongo collections used by the routers.

It implements only the query/update operators the enrollment flow relies on, with
Mongo's semantics for them (null matches a missing field, dotted paths reach into
arrays by index, unique indexes raise DuplicateKeyError). Anything else raises, so
a test never passes by silently ignoring a filter.
"""

import copy
import re
from types import SimpleNamespace
from typing import Any

from pymongo.errors import DuplicateKeyError

_MISSING = object()


def _get(document: Any, path: str) -> Any:
    current = document
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part, _MISSING)
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            current = current[index] if index < len(current) else _MISSING
        else:
            return _MISSING
        if current is _MISSING:
            return _MISSING
    return current


def _match_value(value: Any, condition: Any) -> bool:
    if isinstance(condition, dict) and any(key.startswith("$") for key in condition):
        for operator, operand in condition.items():
            if operator == "$exists":
                if (value is not _MISSING) != bool(operand):
                    return False
            elif operator == "$ne":
                if _match_value(value, operand):
                    return False
            elif operator == "$in":
                if not any(_match_value(value, item) for item in operand):
                    return False
            elif operator == "$regex":
                flags = re.IGNORECASE if "i" in condition.get("$options", "") else 0
                if not isinstance(value, str) or not re.search(operand, value, flags):
                    return False
            elif operator == "$options":
                continue
            elif operator in ("$lt", "$gt"):
                if value is _MISSING or value is None:
                    return False
                if not (value < operand if operator == "$lt" else value > operand):
                    return False
            else:
                raise NotImplementedError(f"operador {operator} não suportado no fake")
        return True
    if condition is None:
        return value is _MISSING or value is None
    if isinstance(value, list) and not isinstance(condition, list):
        return condition in value
    return value == condition


def matches(document: dict, query: dict) -> bool:
    for key, condition in query.items():
        if key == "$or":
            if not any(matches(document, branch) for branch in condition):
                return False
        elif key.startswith("$"):
            raise NotImplementedError(f"operador {key} não suportado no fake")
        elif not _match_value(_get(document, key), condition):
            return False
    return True


def _eval_pipeline(expr, document: dict, now):
    """Minimal pipeline-expression evaluator: literals, "$$NOW", $dateDiff and $max."""
    from datetime import datetime
    if isinstance(expr, str) and expr == "$$NOW":
        return now if now is not None else datetime.now()
    if isinstance(expr, dict):
        if "$dateDiff" in expr:
            spec = expr["$dateDiff"]
            start = _eval_pipeline(spec["startDate"], document, now)
            end = _eval_pipeline(spec["endDate"], document, now)
            seconds = int((end - start).total_seconds())
            return seconds if spec.get("unit") == "second" else seconds
        if "$max" in expr:
            values = [_eval_pipeline(item, document, now) for item in expr["$max"]]
            return max(values)
        return {key: _eval_pipeline(value, document, now) for key, value in expr.items()}
    if isinstance(expr, str) and expr.startswith("$"):
        return document.get(expr[1:])
    return copy.deepcopy(expr)


def _apply(document: dict, update: dict) -> None:
    # Aggregation pipeline: resolves $$NOW once and evaluates the stages against
    # the document (supports $set with $dateDiff/$max, which the audit fixes use).
    if isinstance(update, list):
        from lib.dates import now_utc
        now = now_utc()
        for stage in update:
            if not isinstance(stage, dict) or "$set" not in stage:
                continue
            for key, expr in stage["$set"].items():
                document[key] = _eval_pipeline(expr, document, now)
        return
    for operator, fields in update.items():
        for key, value in fields.items():
            if operator == "$set":
                document[key] = copy.deepcopy(value)
            elif operator == "$unset":
                document.pop(key, None)
            elif operator == "$inc":
                document[key] = document.get(key, 0) + value
            elif operator == "$addToSet":
                items = document.setdefault(key, [])
                if value not in items:
                    items.append(value)
            elif operator == "$pull":
                document[key] = [item for item in document.get(key, []) if item != value]
            else:
                raise NotImplementedError(f"update {operator} não suportado no fake")


class FakeCursor:
    def __init__(self, documents: list[dict]):
        self._documents = documents

    def sort(self, key: str, direction: int = 1) -> "FakeCursor":
        present = [doc for doc in self._documents if doc.get(key) is not None]
        absent = [doc for doc in self._documents if doc.get(key) is None]
        self._documents = sorted(present, key=lambda doc: doc[key], reverse=direction < 0) + absent
        return self

    def limit(self, count: int) -> "FakeCursor":
        self._documents = self._documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict]:
        return self._documents[:length] if length else list(self._documents)

    def __aiter__(self):
        self._iter = iter(self._documents)
        return self

    async def __anext__(self) -> dict:
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeCollection:
    def __init__(self, documents: list[dict] | None = None, unique: list[tuple[str, dict | None]] | None = None):
        self.documents = [copy.deepcopy(doc) for doc in documents or []]
        # (field, partialFilterExpression or None)
        self.unique = unique or []

    def _violates_unique(self, candidate: dict, ignore: dict | None = None) -> bool:
        for field, partial in self.unique:
            if partial and not matches(candidate, partial):
                continue
            value = candidate.get(field)
            for existing in self.documents:
                if existing is ignore or (partial and not matches(existing, partial)):
                    continue
                if existing.get(field) == value:
                    return True
        return False

    async def find_one(self, query: dict, projection: dict | None = None) -> dict | None:
        for document in self.documents:
            if matches(document, query):
                return copy.deepcopy(document)
        return None

    def find(self, query: dict, projection: dict | None = None) -> FakeCursor:
        return FakeCursor([copy.deepcopy(doc) for doc in self.documents if matches(doc, query)])

    async def count_documents(self, query: dict) -> int:
        return sum(1 for doc in self.documents if matches(doc, query))

    async def insert_one(self, document: dict):
        if self._violates_unique(document):
            raise DuplicateKeyError("duplicate key")
        self.documents.append(copy.deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict, update: dict):
        for document in self.documents:
            if matches(document, query):
                updated = copy.deepcopy(document)
                _apply(updated, update)
                if self._violates_unique(updated, ignore=document):
                    raise DuplicateKeyError("duplicate key")
                changed = updated != document
                document.clear()
                document.update(updated)
                return SimpleNamespace(matched_count=1, modified_count=int(changed))
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def find_one_and_update(self, query: dict, update: dict, return_document=None, **_):
        """Mirrors ReturnDocument.AFTER when requested, BEFORE otherwise."""
        for document in self.documents:
            if matches(document, query):
                before = copy.deepcopy(document)
                _apply(document, update)
                return copy.deepcopy(document) if return_document else before
        return None

    async def update_many(self, query: dict, update: dict):
        targets = [doc for doc in self.documents if matches(doc, query)]
        for document in targets:
            _apply(document, update)
        return SimpleNamespace(matched_count=len(targets), modified_count=len(targets))

    async def delete_many(self, query: dict):
        kept = [doc for doc in self.documents if not matches(doc, query)]
        deleted = len(self.documents) - len(kept)
        self.documents = kept
        return SimpleNamespace(deleted_count=deleted)

    async def delete_one(self, query: dict):
        for index, document in enumerate(self.documents):
            if matches(document, query):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


def enrollment_db(**collections: FakeCollection) -> SimpleNamespace:
    """A db namespace with the collections and unique indexes the flow touches."""
    defaults = {
        "users": FakeCollection(unique=[("email", None), ("documento_hash", {"documento_hash": {"$exists": True}})]),
        "alunos": FakeCollection(),
        "turmas": FakeCollection(),
        "turma_convites": FakeCollection(unique=[("codigo", None)]),
        "solicitacoes_turma": FakeCollection(unique=[("aluno_id", {"status": "pendente"})]),
        # Cascata da exclusão de turma (aulas e sessões de presença).
        "subgrupos": FakeCollection(),
        "sessoes_presenca": FakeCollection(),
    }
    defaults.update(collections)
    return SimpleNamespace(**defaults)
