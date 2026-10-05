# Read-only View As: the original session and database roles are never modified.

import logging
from fastapi import Request, HTTPException, Depends, Header
from lib.security import get_current_user
from models.models import User
from lib.db import db
logger = logging.getLogger(__name__)
IMPERSONATE_HEADER = "X-Impersonate-Role"
TARGET_HEADER = "X-Impersonate-Target"


def allowed_view_path(path: str, role: str) -> bool:
    parts = path.split("/")
    if role == "aluno" and (
        path in {"/api/student/portal", "/api/enrollment/classes", "/api/enrollment/requests/me"} or
        (len(parts) == 5 and parts[1:3] == ["api", "student"] and parts[4] in {"ranking", "questions", "schedule"} and bool(parts[3])) or
        (len(parts) == 5 and parts[1:4] == ["api", "atividades", "aluno"] and bool(parts[4]))
    ):
        return True
    if role == "professor" and (
        path in {
            "/api/professor/dashboard", "/api/professor/students", "/api/professor/agenda", "/api/professor/visao-geral",
            "/api/enrollment/teacher/invites", "/api/enrollment/teacher/requests", "/api/atividades/professor",
        } or
        (len(parts) == 6 and parts[1:4] == ["api", "professor", "students"] and parts[5] == "questions" and bool(parts[4])) or
        (len(parts) == 5 and parts[1:4] == ["api", "atividades", "professor"] and bool(parts[4]))
    ):
        return True
    return role in {"aluno", "professor"} and (
        path == "/api/treinamentos/torneios" or
        (len(parts) == 5 and parts[1:4] == ["api", "treinamentos", "torneios"] and bool(parts[4]))
    )


async def get_current_user_with_impersonation(
    request: Request,
    role: str | None = Header(None, alias=IMPERSONATE_HEADER),
    target_id: str | None = Header(None, alias=TARGET_HEADER),
    actor: User = Depends(get_current_user),
) -> User:
    if role is None and target_id is None:
        return actor
    if not role or not target_id or role not in {"aluno", "professor"}:
        raise HTTPException(status_code=400, detail="Visão ou conta-alvo inválida")
    if actor.tipo != "admin" or not actor.is_root_admin or actor.status != "ativo":
        raise HTTPException(status_code=403, detail="Apenas o administrador raiz pode visualizar outro perfil")
    if request.method != "GET" or not allowed_view_path(request.url.path, role):
        raise HTTPException(status_code=403, detail="Visualização permitida apenas para consultas da área selecionada")

    target = await db.users.find_one({"id": target_id, "tipo": role, "status": "ativo"}, {"_id": 0})
    if not target or (role == "aluno" and not target.get("aluno_id")):
        raise HTTPException(status_code=404, detail="Conta-alvo ativa não encontrada")
    logger.info("view_as actor=%s target=%s role=%s path=%s", actor.id, target_id, role, request.url.path)
    # Only the read endpoint sees this identity. No token or database record changes.
    return User.model_validate(target)


