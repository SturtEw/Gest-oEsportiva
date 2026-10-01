"""Authorization helpers for the student/family portal.

Never trust an alumno_id supplied by the browser without resolving it against
an authenticated student identity or an existing guardian relationship.

"""

from fastapi import HTTPException


from lib.db import db
from models.models import Aluno, User


async def get_authorized_aluno(user: User, aluno_id: str) -> Aluno:
    if user.tipo not in ("aluno", "responsavel"):
        raise HTTPException(status_code=403, detail="Acesso restrito à área do aluno")

    if user.tipo == "aluno" and user.aluno_id != aluno_id:
        raise HTTPException(status_code=403, detail="Esta conta não tem acesso a este aluno")

    document = await db.alunos.find_one({"id": aluno_id}, {"_id": 0})

    if not document:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    if user.tipo == "aluno" and user.aluno_id == aluno_id:
        return Aluno.model_validate(document)

    linked_by_account = aluno_id in user.filhos_ids

    linked_by_profile = document.get("responsavel_id") == user.id

    if not (linked_by_account or linked_by_profile):
        raise HTTPException(status_code=403, detail="Esta conta não tem acesso a este aluno")

    return Aluno.model_validate(document)



async def require_assigned_professor(user: User, aluno_id: str) -> tuple[Aluno, dict]:
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso restrito a professores aprovados")

    student_doc = await db.alunos.find_one({"id": aluno_id}, {"_id": 0})

    if not student_doc:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    student = Aluno.model_validate(student_doc)

    if not student.turma_id:
        raise HTTPException(status_code=409, detail="O aluno ainda não está vinculado a uma turma")

    class_doc = await db.turmas.find_one({"id": student.turma_id}, {"_id": 0})

    if not class_doc or class_doc.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="A turma não está vinculada a este professor")

    return student, class_doc
