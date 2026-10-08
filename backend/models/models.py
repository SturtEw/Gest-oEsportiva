"""Pydantic v2 models — the single source of truth mirrored by
frontend/src/lib/types.ts (keep the pair in sync in the same edit).
"""

import uuid
from datetime import datetime
from typing import Any, Literal, Optional


from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


from lib.dates import ensure_aware, now_utc as _now_utc, today_in_app_tz


TipoUsuario = Literal["admin", "professor", "responsavel", "aluno"]
StatusUsuario = Literal["ativo", "pendente", "inativo", "reprovado"]


StatusChamada = Literal["presente", "ausente", "justificada"]


TipoOcorrencia = Literal["lesao", "comportamento", "positivo"]


Severidade = Literal["leve", "moderada", "grave"]


StatusJustificativa = Literal["pendente", "aprovada", "rejeitada"]


PrioridadeFila = Literal["normal", "alta", "urgente"]


StatusFila = Literal["aguardando", "confirmado", "cancelado"]


CanalComunicado = Literal["email", "whatsapp", "ambos"]


MotivoJustificativa = Literal["doenca_escolar", "doenca", "compromisso_familiar", "outro"]


def now_utc() -> datetime:
    """Aware UTC "now" — single source of truth lives in lib.dates."""
    return _now_utc()

class UtcDatetimeModel(BaseModel):
    """Base model that normalises any datetime read from Mongo to aware UTC.

    PyMongo hands BSON dates back naive unless the client is ``tz_aware``. A naive
    datetime serialises without an offset, so the browser's ``new Date()`` reads it as

    local time and every displayed timestamp drifts by the APP_TZ offset. Normalising

    here fixes the whole payload in one place instead of at each call site.

    """

    @field_validator("*", mode="after")
    @classmethod

    def _normalize_datetimes(cls, value: Any) -> Any:
        return ensure_aware(value) if isinstance(value, datetime) else value


def novo_id() -> str:
    return str(uuid.uuid4())


# ---------- Usuários / Auth ----------
class User(BaseModel):
    id: str = Field(default_factory=novo_id)

    nome: str

    email: str

    cpf: Optional[str] = None

    senha_hash: str = ""

    google_sub: Optional[str] = None

    tipo: TipoUsuario

    aluno_id: Optional[str] = None

    data_nascimento: Optional[str] = None

    documento_tipo: Optional[Literal["cpf", "rg", "outro"]] = None

    documento_hash: Optional[str] = None

    documento_final: Optional[str] = None

    formacao_academica: Optional[str] = None

    area_atuacao: Optional[str] = None

    motivo_reprovacao: Optional[str] = None

    status: StatusUsuario = "ativo"

    telefone: Optional[str] = None

    filhos_ids: list[str] = []

    is_root_admin: bool = False

    # Self-service profile: preset id or base64 photo, always optional.
    avatar: Optional[dict] = None

    # Pre-account-takeover defense. A password registration proves nothing about e-mail
    # ownership, so the account stays unverified until the owner confirms the address.
    # Unverified accounts cannot log in locally, and they only gain google_sub when the
    # Google ID token carries email_verified=true (see auth.py account linking).
    email_verified: bool = False

    # SHA-256 of the one-time confirmation token. The raw token exists only in the
    # e-mail link, exactly like the password-reset flow — storing the hash means a
    # database leak cannot be replayed as a confirmation link.
    verification_token_hash: Optional[str] = None

    verification_expires_at: Optional[datetime] = None

    dataCriacao: datetime = Field(default_factory=now_utc)

    # Token revocation: when set, any token issued before this datetime is
    # considered revoked. Set on logout, password change, or account rejection.
    token_valid_after: Optional[datetime] = None


class RegistrarInput(BaseModel):
    nome: str = Field(min_length=3, max_length=120)

    email: EmailStr

    cpf: Optional[str] = None

    telefone: Optional[str] = None

    senha: str = Field(min_length=6, max_length=72)

    tipo: Literal["professor", "responsavel"]


class LoginInput(BaseModel):
    login: EmailStr

    senha: str = Field(min_length=1, max_length=72)

    # Opcional: o cargo é identificado no banco a partir do e-mail. O campo é
    # aceito apenas para compatibilidade com clientes antigos que ainda enviam a
    # aba selecionada — nunca determina para qual área o usuário entra.
    tipo_esperado: Literal["aluno", "professor", "admin"] | None = None


class UserPublic(BaseModel):
    id: str

    nome: str

    email: str

    cpf: Optional[str] = None

    tipo: TipoUsuario

    aluno_id: Optional[str] = None

    status: StatusUsuario

    telefone: Optional[str] = None

    filhos_ids: list[str] = Field(default_factory=list)

    dataCriacao: datetime


# ---------- Turmas / Alunos ----------
class Turma(BaseModel):
    id: str = Field(default_factory=novo_id)

    nome: str

    modalidade: str

    professor_id: Optional[str] = None

    ano: int

    capacidade: int = Field(default=20, ge=1, le=500)

    alunos_ids: list[str] = []

    dataCriacao: datetime = Field(default_factory=now_utc)


class TurmaCreate(BaseModel):
    nome: str = Field(min_length=3, max_length=80)

    modalidade: str = Field(min_length=2, max_length=40)

    professor_id: Optional[str] = None

    ano: int = Field(ge=2020, le=2100)

    capacidade: int = Field(default=20, ge=1, le=500)


class Aluno(BaseModel):
    id: str = Field(default_factory=novo_id)

    nome: str

    # Turma principal (legado): mantida como "a primeira" para compatibilidade
    # com ranking, presencas e telas antigas. Novo código deve preferir turmas_ids.
    turma_id: Optional[str] = None

    # Multi-enrollment: todas as turmas do aluno (many-to-many com turmas).
    # Mantido em sincronia com turma_id: turma_id == turmas_ids[0] quando existe.
    turmas_ids: list[str] = Field(default_factory=list)

    data_nascimento: Optional[str] = None  # YYYY-MM-DD

    responsavel_id: Optional[str] = None

    responsavel_email: Optional[str] = None

    responsavel_telefone: Optional[str] = None

    participa_ranking: bool = False

    consentimentoRankingAtualizadoEm: Optional[datetime] = None

    dataCriacao: datetime = Field(default_factory=now_utc)


class AlunoCreate(BaseModel):
    nome: str = Field(min_length=3, max_length=120)

    turma_id: Optional[str] = None

    data_nascimento: Optional[str] = None

    responsavel_email: Optional[EmailStr] = None

    responsavel_telefone: Optional[str] = None


# ---------- Multi-turmas / matrículas ----------

class EnrollmentInput(BaseModel):
    """Teacher sets a student's class list (the first one is the primary turma_id)."""

    turmas_ids: list[str] = Field(min_length=1, max_length=20)


class AlunoEnrollments(BaseModel):
    """Wire model: a student and all classes they belong to."""

    id: str

    nome: str

    turma_id: Optional[str] = None

    turmas_ids: list[str] = Field(default_factory=list)

    turmas: list["StudentClassSummary"] = Field(default_factory=list)


# ---------- Fórum de turma (chat estilo WhatsApp) ----------

class ForumMessage(BaseModel):
    """A chat message inside a class forum. The document stored in Mongo is this
    plus `turma_id`. History pagination uses `criado_em` (descending) — the
    frontend opens the chat with limit=50 and pages up for older messages."""

    id: str = Field(default_factory=novo_id)

    turma_id: str

    autor_id: str  # user id (professor or aluno user), not the Aluno doc id

    autor_nome: str

    autor_tipo: str  # 'professor' | 'aluno'

    autor_avatar: Optional[str] = None  # url da foto de perfil

    texto: str = Field(min_length=1, max_length=2000)

    criado_em: datetime = Field(default_factory=now_utc)


class ForumMessageOut(BaseModel):
    """Wire shape for a chat message (what the frontend renders)."""

    id: str

    autor_id: str

    autor_nome: str

    autor_tipo: str

    autor_avatar: Optional[str] = None

    texto: str

    criado_em: datetime


class ForumMessageCreate(BaseModel):

    texto: str = Field(min_length=1, max_length=2000)


# ---------- Notificações in-app ----------

class Notificacao(BaseModel):
    """In-app notification for a aluno user. `destinatario_id` is the *user* id
    (the account that owns the bell), so guardians and the student see separate
    bells. `aluno_id` is the underlying student doc, kept for admin queries."""

    id: str = Field(default_factory=novo_id)

    destinatario_id: str  # user id

    aluno_id: Optional[str] = None

    titulo: str

    mensagem: str

    lida: bool = False

    # Where to navigate when tapped (e.g. /aluno/atividades).
    link: Optional[str] = None

    criado_em: datetime = Field(default_factory=now_utc)


class NotificacaoOut(BaseModel):

    id: str

    titulo: str

    mensagem: str

    lida: bool

    link: Optional[str] = None

    criado_em: datetime


# ---------- Agenda de aulas ----------
class AulaAgenda(BaseModel):
    """A scheduled class session for a turma.

    This is the schedule the teacher area renders ("Próximas aulas", "Aulas de hoje").
    It is deliberately separate from Chamada: the agenda is the *plan* for a day,
    while a Chamada is the *record* of who actually showed up. They meet on
    (turma_id, data_aula) — one agenda entry per class per day.
    """

    id: str = Field(default_factory=novo_id)

    turma_id: str

    # Calendar day in APP_TZ, YYYY-MM-DD. Not an instant: a class on 2026-03-04
    # happens on 2026-03-04 regardless of the reader's timezone.
    data_aula: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    # Local wall-clock time as HH:MM, also a calendar value, not an instant.
    hora_inicio: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    duracao_minutos: int = Field(default=60, ge=15, le=480)

    local: Optional[str] = None

    observacoes: str = ""

    ativo: bool = True

    dataCriacao: datetime = Field(default_factory=now_utc)


class AulaAgendaCreate(BaseModel):
    turma_id: str

    data_aula: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    hora_inicio: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    duracao_minutos: int = Field(default=60, ge=15, le=480)

    local: Optional[str] = None

    observacoes: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _reject_past_date(self) -> "AulaAgendaCreate":
        # Guard against scheduling a session that already elapsed. Compared as
        # calendar dates in APP_TZ, never in UTC — otherwise "today" flips at 21:00
        # local and a class planned for this evening would be rejected.
        if self.data_aula < today_in_app_tz().isoformat():
            raise ValueError("Não é possível agendar uma aula para uma data já passou.")
        return self


class AulaAgendaUpdate(BaseModel):
    data_aula: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    hora_inicio: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    duracao_minutos: Optional[int] = Field(default=None, ge=15, le=480)

    local: Optional[str] = None

    observacoes: Optional[str] = Field(default=None, max_length=500)

    ativo: Optional[bool] = None


# ---------- Avaliações / Gamificação ----------
class Criterios(BaseModel):
    fundamentos: float = Field(ge=0, le=10)

    condicionamento_fisico: float = Field(ge=0, le=10)

    disciplina: float = Field(ge=0, le=10)

    trabalho_em_equipe: float = Field(ge=0, le=10)

    assiduidade: float = Field(ge=0, le=10)


class Avaliacao(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    turma_id: str

    bimestre: str = Field(pattern=r"^\d{4}-Q[1-4]$")

    professor_id: str

    criterios: Criterios

    media: float

    observacoes: str = ""

    dataAvaliacao: datetime = Field(default_factory=now_utc)

    dataAtualizacao: Optional[datetime] = None


class AvaliacaoCreate(BaseModel):
    aluno_id: str

    turma_id: str

    bimestre: str = Field(pattern=r"^\d{4}-Q[1-4]$", examples=["2025-Q1"])

    fundamentos: float = Field(ge=0, le=10)

    condicionamento_fisico: float = Field(ge=0, le=10)

    disciplina: float = Field(ge=0, le=10)

    trabalho_em_equipe: float = Field(ge=0, le=10)

    assiduidade: float = Field(ge=0, le=10)

    observacoes: Optional[str] = Field(default=None, max_length=2000)


class Badge(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    badge_id: Literal["talento_ascendente", "mestre_disciplina", "folego_ouro"]

    nome: str

    dataObtencao: datetime = Field(default_factory=now_utc)

    professor_id: str


# ---------- Chamadas ----------
class Presenca(BaseModel):
    status: StatusChamada

    dataRegistro: datetime = Field(default_factory=now_utc)

    justificativa_id: Optional[str] = None


class Chamada(BaseModel):
    id: str = Field(default_factory=novo_id)

    turma_id: str

    data_aula: str  # YYYY-MM-DD

    professor_id: str

    presencas: dict[str, Presenca] = {}

    concluida: bool = False

    dataRegistro: datetime = Field(default_factory=now_utc)


class ChamadaCreate(BaseModel):
    turma_id: str

    data_aula: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class PresencaInput(BaseModel):
    aluno_id: str

    status: StatusChamada


# ---------- Ocorrências ----------
class Ocorrencia(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    turma_id: str

    tipo: TipoOcorrencia

    titulo: str = Field(min_length=3, max_length=120)

    descricao: str = Field(min_length=5, max_length=4000)

    severidade: Optional[Severidade] = None

    acao: str = "Registrado"

    acompanhamento: str = "Monitorando"

    dataOcorrencia: datetime = Field(default_factory=now_utc)

    professor_id: str

    resolvida: bool = False

    dataResolucao: Optional[datetime] = None


class OcorrenciaCreate(BaseModel):
    aluno_id: str

    turma_id: str

    tipo: TipoOcorrencia

    titulo: str = Field(min_length=3, max_length=120)

    descricao: str = Field(min_length=5, max_length=4000)

    severidade: Optional[Severidade] = None

    acao: Optional[str] = Field(default=None, max_length=2000)

    acompanhamento: Optional[str] = Field(default=None, max_length=2000)


    @model_validator(mode="after")

    def severidade_obrigatoria_para_lesao(self):
        if self.tipo == "lesao" and not self.severidade:
            raise ValueError("Severidade é obrigatória quando o tipo for 'lesao'")

        return self


# ---------- Justificativas ----------
class Justificativa(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    turma_id: str

    data_falta: str  # YYYY-MM-DD

    motivo: MotivoJustificativa

    descricao: str = Field(min_length=5, max_length=4000)

    evidencia: Optional[str] = None

    status: StatusJustificativa = "pendente"

    dataJustificativa: datetime = Field(default_factory=now_utc)

    respondente: Literal["responsavel", "aluno"] = "responsavel"

    analisada_por: Optional[str] = None

    motivoRejeicao: Optional[str] = None

    dataAnalise: Optional[datetime] = None


class JustificativaCreate(BaseModel):
    aluno_id: str

    data_falta: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    motivo: MotivoJustificativa

    descricao: str = Field(min_length=5, max_length=4000)

    evidencia: Optional[str] = Field(default=None, max_length=500)


class RejeitarInput(BaseModel):
    motivo_rejeicao: str = Field(min_length=5, max_length=1000)


# ---------- Fila de espera ----------
class FilaEspera(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    turma_id: str

    prioridade: PrioridadeFila = "normal"

    status: StatusFila = "aguardando"

    posicao: int = 0

    dataSolicitacao: datetime = Field(default_factory=now_utc)

    dataConfirmacao: Optional[datetime] = None

    dataCancelamento: Optional[datetime] = None

    motivoCancelamento: Optional[str] = None


class FilaEsperaCreate(BaseModel):
    aluno_id: str

    turma_id: str

    prioridade: PrioridadeFila = "normal"


# ---------- Convites e solicitações de entrada em turma ----------
StatusSolicitacaoTurma = Literal["pendente", "aprovada", "rejeitada", "cancelada"]


class TurmaConvite(BaseModel):
    """Invite code a teacher shares so a student enters the class directly.

    `codigo` is globally unique (unique index) and belongs to exactly one turma.
    At most one invite per turma is active: generating a new one deactivates the
    previous, so a leaked code can always be rotated.
    """

    id: str = Field(default_factory=novo_id)

    codigo: str = Field(pattern=r"^[A-HJ-NP-Z2-9]{8}$")

    turma_id: str

    professor_id: str

    ativo: bool = True

    usos: int = 0

    expira_em: Optional[datetime] = None

    dataCriacao: datetime = Field(default_factory=now_utc)

    revogado_em: Optional[datetime] = None


class SolicitacaoTurma(BaseModel):
    """A student's request to join a class, decided by that class's teacher."""

    id: str = Field(default_factory=novo_id)

    aluno_id: str

    aluno_nome: str

    turma_id: str

    # Snapshot of the class teacher at request time. Decisions still re-check the
    # turma's *current* professor_id, so a reassigned class moves its queue along.
    professor_id: str

    status: StatusSolicitacaoTurma = "pendente"

    mensagem: Optional[str] = Field(default=None, max_length=300)

    motivo_rejeicao: Optional[str] = Field(default=None, max_length=300)

    decidido_por: Optional[str] = None

    dataSolicitacao: datetime = Field(default_factory=now_utc)

    dataDecisao: Optional[datetime] = None


# ---------- Comunicados ----------
class DestinatarioResultado(BaseModel):
    destinatario: str

    canal: Literal["email", "whatsapp"]

    status: Literal["enviado", "falha"]

    erro: Optional[str] = None

    dataEnvio: Optional[datetime] = None


class Comunicado(BaseModel):
    id: str = Field(default_factory=novo_id)

    turma_id: str

    autor_id: str

    autor_nome: str

    titulo: str = Field(min_length=3, max_length=150)

    mensagem: str = Field(min_length=5, max_length=8000)

    tipo: CanalComunicado = "email"

    urgente: bool = False

    status: Literal["enviado", "falha_parcial", "falha"] = "enviado"

    capa_url: Optional[str] = None

    dataEnvio: datetime = Field(default_factory=now_utc)

    destinatarios: list[DestinatarioResultado] = []

    leituras: dict[str, datetime] = {}


class ComunicadoCreate(BaseModel):
    turma_id: str

    titulo: str = Field(min_length=3, max_length=150)

    mensagem: str = Field(min_length=5, max_length=8000)

    tipo: CanalComunicado = "email"

    urgente: bool = False

    capa_url: Optional[str] = Field(default=None, max_length=300)


    @field_validator("tipo")

    @classmethod

    def canal_valido(cls, v: str) -> str:
        if v not in ("email", "whatsapp", "ambos"):
            raise ValueError("Canal inválido")

        return v


# ---------- Dashboard ----------
class DashboardPayload(BaseModel):
    papel: TipoUsuario

    stats: dict[str, int] = {}

    turmas: list[Turma] = []

    pendentes: list[UserPublic] = []

    justificativas_pendentes: int = 0

    filhos: list[dict] = []

    auditoria: list[dict] = []

    comunicados_recentes: list[Comunicado] = []

    avaliacoes_recentes: list[dict] = []

    chamadas_hoje: list[dict] = []


class QuestionMessage(BaseModel):
    id: str = Field(default_factory=novo_id)

    aluno_id: str

    turma_id: str

    professor_id: str

    autor_id: str

    autor_tipo: Literal["aluno", "responsavel", "professor"]

    texto: str = Field(min_length=1, max_length=2000)

    dataEnvio: datetime = Field(default_factory=now_utc)


class QuestionMessageCreate(BaseModel):
    texto: str = Field(min_length=1, max_length=2000)


class Conquista(BaseModel):
    """Auditable teacher-awarded points. Legacy Badge records remain unscored."""
    id: str = Field(default_factory=novo_id)
    aluno_id: str

    turma_id: str

    professor_id: str

    badge_id: Optional[Literal["talento_ascendente", "mestre_disciplina", "folego_ouro"]] = None

    nome: str = Field(min_length=2, max_length=120)

    pontos: int = Field(gt=0, le=10000)

    dataObtencao: datetime = Field(default_factory=now_utc)


class StudentAttendanceRecord(BaseModel):
    chamada_id: str

    turma_id: str

    data_aula: str

    status: Optional[StatusChamada] = None

    dataRegistro: Optional[datetime] = None


class StudentAnnouncement(BaseModel):
    id: str

    titulo: str

    mensagem: str

    urgente: bool = False

    autor_nome: str

    dataEnvio: datetime


class StudentProfileSummary(BaseModel):
    id: str

    nome: str

    turma_id: Optional[str] = None

    participa_ranking: bool = False

    consentimentoRankingAtualizadoEm: Optional[datetime] = None


class StudentClassSummary(BaseModel):
    id: str

    nome: str

    modalidade: str

    ano: int


class StudentAssessment(BaseModel):
    id: str

    bimestre: str

    criterios: Criterios

    media: float

    observacoes: str = ""

    dataAvaliacao: datetime

    dataAtualizacao: Optional[datetime] = None


class StudentIncident(BaseModel):
    id: str

    tipo: TipoOcorrencia

    titulo: str

    descricao: str

    severidade: Optional[Severidade] = None

    dataOcorrencia: datetime

    resolvida: bool = False


class StudentJustification(BaseModel):
    id: str

    data_falta: str

    motivo: MotivoJustificativa

    descricao: str

    status: StatusJustificativa

    motivoRejeicao: Optional[str] = None

    dataJustificativa: datetime

    dataAnalise: Optional[datetime] = None


class StudentAward(BaseModel):
    id: str

    badge_id: Optional[str] = None

    nome: str

    pontos: Optional[int] = None

    dataObtencao: datetime


class StudentMessagePublic(BaseModel):
    id: str

    autor_nome: str

    autor_tipo: Literal["aluno", "responsavel", "professor"]

    texto: str

    dataEnvio: datetime


class RankingEntry(BaseModel):
    posicao: int

    nome: str

    pontos: int


class RankingResponse(BaseModel):
    enabled: bool

    entries: list[RankingEntry] = Field(default_factory=list)


class RankingPreferenceUpdate(BaseModel):
    participa_ranking: bool


class ConquistaCreate(BaseModel):
    badge_id: Optional[Literal["talento_ascendente", "mestre_disciplina", "folego_ouro"]] = None

    nome: str = Field(min_length=2, max_length=120)

    pontos: int = Field(gt=0, le=10000)


class StudentPortalPayload(BaseModel):
    aluno: StudentProfileSummary

    turma: Optional[StudentClassSummary] = None

    professor_nome: Optional[str] = None

    presencas: list[StudentAttendanceRecord] = Field(default_factory=list)

    avaliacoes: list[StudentAssessment] = Field(default_factory=list)

    conquistas: list[StudentAward] = Field(default_factory=list)

    ocorrencias: list[StudentIncident] = Field(default_factory=list)

    justificativas: list[StudentJustification] = Field(default_factory=list)

    comunicados: list[StudentAnnouncement] = Field(default_factory=list)

    atualizado_em: datetime = Field(default_factory=now_utc)


# ---------- Treinamentos ----------
# Os schemas de prescrição/execução de treino foram removidos junto com
# backend/routers/treinamentos.py, que nunca era montado em server.py (código
# morto). Os torneios usam os schemas Training* em routers/treinamentos_torneios.py.
