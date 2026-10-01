"""Build allow-listed, per-student portal payloads from existing collections."""


from typing import Any


from lib.dates import now_utc
from lib.db import db
from models.models import (

    StudentAnnouncement,
    StudentAssessment,

    StudentAttendanceRecord,

    StudentAward,

    StudentClassSummary,

    StudentIncident,

    StudentJustification,

    StudentPortalPayload,

    StudentProfileSummary,


)


CRITERIA = (

    "fundamentos",

    "condicionamento_fisico",

    "disciplina",

    "trabalho_em_equipe",

    "assiduidade",


)


def _assessment(document: dict[str, Any]) -> StudentAssessment | None:
    criteria = document.get("criterios")

    if not criteria:
        criteria = {key: document[key] for key in CRITERIA if key in document}

    if len(criteria) != len(CRITERIA):
        return None

    average = document.get("media")

    if average is None:
        average = round(sum(float(criteria[key]) for key in CRITERIA) / len(CRITERIA), 2)

    return StudentAssessment(

        id=document["id"],

        bimestre=document["bimestre"],

        criterios=criteria,

        media=average,

        observacoes=document.get("observacoes") or "",

        dataAvaliacao=document["dataAvaliacao"],

        dataAtualizacao=document.get("dataAtualizacao"),

    )


async def build_student_payload(student: Any) -> StudentPortalPayload:
    class_document = None

    professor_name = None

    if student.turma_id:
        class_document = await db.turmas.find_one(

            {"id": student.turma_id},

            {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "professor_id": 1},

        )

        if class_document and class_document.get("professor_id"):
            professor = await db.users.find_one(

                {"id": class_document["professor_id"], "tipo": "professor"},

                {"_id": 0, "nome": 1},

            )

            professor_name = professor.get("nome") if professor else None

    attendance: list[StudentAttendanceRecord] = []

    if student.turma_id:
        attendance_projection = {

            "_id": 0,

            "id": 1,

            "turma_id": 1,

            "data_aula": 1,

            f"presencas.{student.id}.status": 1,

            f"presencas.{student.id}.dataRegistro": 1,

        }

        cursor = db.chamadas.find({"turma_id": student.turma_id}, attendance_projection).sort("data_aula", -1).limit(60)

        async for record in cursor:
            own_record = (record.get("presencas") or {}).get(student.id) or {}

            attendance.append(

                StudentAttendanceRecord(

                    chamada_id=record["id"],

                    turma_id=record["turma_id"],

                    data_aula=record["data_aula"],

                    status=own_record.get("status"),

                    dataRegistro=own_record.get("dataRegistro"),

                )

            )

    assessments = []

    async for record in db.avaliacoes.find({"aluno_id": student.id}, {"_id": 0}).sort("bimestre", -1).limit(20):
        result = _assessment(record)

        if result:
            assessments.append(result)

    awards: list[StudentAward] = []

    async for record in db.conquistas.find({"aluno_id": student.id}, {"_id": 0}).sort("dataObtencao", -1).limit(100):
        awards.append(

            StudentAward(

                id=record["id"],

                badge_id=record.get("badge_id"),

                nome=record["nome"],

                pontos=record.get("pontos"),

                dataObtencao=record["dataObtencao"],

            )

        )

    async for record in db.badges.find({"aluno_id": student.id}, {"_id": 0}).sort("dataObtencao", -1).limit(100):
        awards.append(

            StudentAward(

                id=record["id"],

                badge_id=record.get("badge_id"),

                nome=record["nome"],

                pontos=None,

                dataObtencao=record["dataObtencao"],

            )

        )

    awards.sort(key=lambda award: award.dataObtencao, reverse=True)

    incidents: list[StudentIncident] = []

    async for record in db.ocorrencias.find(

        {"aluno_id": student.id},

        {"_id": 0, "id": 1, "tipo": 1, "titulo": 1, "descricao": 1, "severidade": 1, "dataOcorrencia": 1, "resolvida": 1},

    ).sort("dataOcorrencia", -1).limit(50):
        incidents.append(StudentIncident(**record))

    justifications: list[StudentJustification] = []

    async for record in db.justificativas.find(

        {"aluno_id": student.id},

        {"_id": 0, "id": 1, "data_falta": 1, "motivo": 1, "descricao": 1, "status": 1, "motivoRejeicao": 1, "dataJustificativa": 1, "dataAnalise": 1},

    ).sort("dataJustificativa", -1).limit(50):
        justifications.append(StudentJustification(**record))

    announcements: list[StudentAnnouncement] = []

    if student.turma_id:
        async for record in db.comunicados.find(

            {"turma_id": student.turma_id, "status": "enviado"},

            {"_id": 0, "id": 1, "titulo": 1, "mensagem": 1, "urgente": 1, "autor_nome": 1, "dataEnvio": 1},

        ).sort("dataEnvio", -1).limit(50):
            announcements.append(StudentAnnouncement(**record))

    safe_class = StudentClassSummary(

        id=class_document["id"],

        nome=class_document["nome"],

        modalidade=class_document["modalidade"],

        ano=class_document["ano"],

    ) if class_document else None

    return StudentPortalPayload(

        aluno=StudentProfileSummary(

            id=student.id,

            nome=student.nome,

            turma_id=student.turma_id,

            participa_ranking=student.participa_ranking,

            consentimentoRankingAtualizadoEm=student.consentimentoRankingAtualizadoEm,

        ),

        turma=safe_class,

        professor_nome=professor_name,

        presencas=attendance,

        avaliacoes=assessments,

        conquistas=awards,

        ocorrencias=incidents,

        justificativas=justifications,

        comunicados=announcements,

        atualizado_em=now_utc(),

    )
