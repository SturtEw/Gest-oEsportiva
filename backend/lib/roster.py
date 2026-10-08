"""Shared roster helpers — one implementation, used by the activity and
subgroup routers (previously duplicated in both).

Accepts the database handle as an argument so each caller passes its own
`db` — important for tests that inject a FakeCollection into the router.
"""

from typing import Any


async def class_students(db: Any, turma_id: str) -> dict[str, str]:
    """Map of aluno_id -> nome for a class, sorted by name."""
    cursor = db.alunos.find({"turma_id": turma_id}, {"_id": 0, "id": 1, "nome": 1}).sort("nome", 1)
    return {item["id"]: item.get("nome") or "Aluno" async for item in cursor}
