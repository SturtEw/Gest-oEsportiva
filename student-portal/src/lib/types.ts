export type UserRole = 'admin' | 'professor' | 'responsavel' | 'aluno'
export type AccountStatus = 'ativo' | 'pendente' | 'reprovado' | 'inativo'
export type AttendanceStatus = 'presente' | 'ausente' | 'justificada'
export type JustificationStatus = 'pendente' | 'aprovada' | 'rejeitada'
export type PortalSection = 'inicio' | 'turma' | 'presencas' | 'avaliacoes' | 'conquistas' | 'atividades' | 'meu-treino' | 'treinamentos' | 'registros' | 'comunicados' | 'duvidas'
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'single_worker'
export type MessageAuthorRole = 'aluno' | 'responsavel' | 'professor'
export type DeliveryStatus = 'sending' | 'sent' | 'failed'
export type AuthRoleTab = 'aluno' | 'professor'

export interface SessionUser {
  id: string
  nome: string
  email: string
  tipo: UserRole
  status: AccountStatus
  aluno_id: string | null
  filhos_ids: string[]
  is_root_admin: boolean
  tem_senha?: boolean
  google_sub?: string | null
  google_email?: string | null
}

export interface LinkedChild { id: string; nome: string; turma_id?: string | null; participa_ranking: boolean }
export interface StudentProfile { id: string; nome: string; turma_id: string | null; participa_ranking: boolean; consentimentoRankingAtualizadoEm: string | null }
export interface StudentClass { id: string; nome: string; modalidade: string; ano: number }
export interface StudentAttendance { chamada_id: string; turma_id: string; data_aula: string; status: AttendanceStatus | null; dataRegistro: string | null }
export interface Criteria { fundamentos: number; condicionamento_fisico: number; disciplina: number; trabalho_em_equipe: number; assiduidade: number }
export interface StudentAssessment { id: string; bimestre: string; criterios: Criteria; media: number; observacoes: string; dataAvaliacao: string; dataAtualizacao: string | null }
export interface StudentAward { id: string; badge_id: string | null; nome: string; pontos: number | null; dataObtencao: string }
export interface StudentIncident { id: string; tipo: string; titulo: string; descricao: string; severidade: string | null; dataOcorrencia: string; resolvida: boolean }
export interface StudentJustification { id: string; data_falta: string; motivo: string; descricao: string; status: JustificationStatus; motivoRejeicao: string | null; dataJustificativa: string; dataAnalise: string | null }
export interface StudentAnnouncement { id: string; titulo: string; mensagem: string; urgente: boolean; autor_nome: string; dataEnvio: string }
export interface StudentPortalSnapshot { aluno: StudentProfile; turma: StudentClass | null; professor_nome: string | null; presencas: StudentAttendance[]; avaliacoes: StudentAssessment[]; conquistas: StudentAward[]; ocorrencias: StudentIncident[]; justificativas: StudentJustification[]; comunicados: StudentAnnouncement[]; atualizado_em: string }
export interface PublicMessage { id: string; autor_nome: string; autor_tipo: MessageAuthorRole; texto: string; dataEnvio: string; localStatus?: DeliveryStatus }
export interface RankingEntry { posicao: number; nome: string; pontos: number }
export interface RankingResponse { enabled: boolean; entries: RankingEntry[] }

export interface TeacherApplication { id: string; nome: string; email: string; formacao_academica: string | null; area_atuacao: string | null; documento_tipo: string | null; documento_final: string | null; dataCriacao: string }
export interface AdminNotification { id: string; tipo: string; user_id: string; nome: string; email: string; status: 'unread' | 'read'; dataCriacao: string; dataLeitura?: string }
export interface UnassignedStudent { id: string; nome: string; data_nascimento: string | null; turma_id: null }
export interface AdminClass { id: string; nome: string; modalidade: string; ano: number; capacidade: number; alunos_count: number; professor_id?: string | null }
export interface AdminTeacher { id: string; nome: string; email: string }

// ---------- Convite de professor (link gerado pelo administrador raiz) ----------
export type TeacherInviteStatus = 'pendente' | 'usado' | 'expirado' | 'revogado'
export interface InviteClassBrief { id: string; nome: string; modalidade?: string | null; ano?: number | null }
export interface TeacherInvite {
  id: string
  email: string
  nome: string | null
  turma: InviteClassBrief | null
  status: TeacherInviteStatus
  criado_em: string
  expira_em: string | null
  usado_em: string | null
  email_enviado: boolean
}
export interface CreatedTeacherInvite {
  invite: TeacherInvite
  /** Shown once: the server keeps only its hash. */
  token: string
  path: string
  url: string
  email_enviado: boolean
}
export interface TeacherInvitePreview { email: string; nome: string | null; turma: InviteClassBrief | null; expira_em: string | null }
export interface TeacherClass { id: string; nome: string; modalidade: string; ano: number; capacidade: number; total_alunos: number }
export interface RealtimeEvent { type: 'invalidate'; section: string; updatedAt: string; mode?: ConnectionStatus }

// ---------- Matrícula em turmas: convites e solicitações ----------
export type JoinRequestStatus = 'pendente' | 'aprovada' | 'rejeitada' | 'cancelada'
export interface JoinedClass { id: string; nome: string; modalidade: string; ano: number | null }
export interface AvailableClass extends JoinedClass {
  professor_nome: string | null
  capacidade: number
  vagas: number
  lotada: boolean
  /** The signed-in student already has a pending request for this class. */
  solicitacao_pendente: boolean
}
export interface JoinRequest {
  id: string
  aluno_id: string
  aluno_nome: string
  turma_id: string
  turma_nome: string
  modalidade: string | null
  professor_nome: string | null
  status: JoinRequestStatus
  mensagem: string | null
  motivo_rejeicao: string | null
  dataSolicitacao: string
  dataDecisao: string | null
}
export interface StudentEnrollmentStatus { turma_id: string | null; requests: JoinRequest[] }
export interface ClassInvite { id: string; codigo: string; turma_id: string; ativo: boolean; usos: number; expira_em: string | null; expirado: boolean; dataCriacao: string }
export interface TeacherInviteClass { turma_id: string; turma_nome: string; modalidade: string; ano: number | null; capacidade: number; total_alunos: number; convite: ClassInvite | null }
export interface TeacherJoinRequests { requests: JoinRequest[]; pendentes: number }

// ---------- Área do professor: agenda e visão geral ----------
/** A scheduled class session. `data_aula` and `hora_inicio` are calendar values, not instants. */
export interface ScheduledClass {
  id: string
  turma_id: string
  turma_nome: string
  modalidade: string | null
  ano?: number | null
  data_aula: string
  hora_inicio: string
  duracao_minutos: number
  local: string | null
  observacoes?: string
  concluida: boolean
  hoje: boolean
}

export interface TeacherScheduleResponse { aulas: ScheduledClass[]; hoje: string }

export interface TeacherClassSummary {
  id: string
  nome: string
  modalidade: string | null
  ano: number | null
  capacidade: number
  total_alunos: number
  vagas: number
  /** null when the class has no capacity configured — 0% would be a lie. */
  ocupacao_percentual: number | null
}

export interface TeacherStudentRow {
  id: string
  nome: string
  turma_id: string | null
  turma_nome: string
  turma_modalidade: string | null
  presencas: number
  faltas: number
  justificadas: number
  /** null when the student has no attendance recorded yet. */
  frequencia_percentual: number | null
  media: number | null
  duvidas_pendentes: number
}

export interface TeacherKpis {
  total_alunos: number
  total_turmas: number
  aulas_hoje: number
  aulas_semana: number
  /** null when no attendance has been recorded — see TeacherOverview docstring. */
  frequencia_media: number | null
  alunos_sem_turma: number
  ocupacao_percentual: number | null
  duvidas_pendentes: number
}

export interface TeacherOverview {
  kpis: TeacherKpis
  turmas: TeacherClassSummary[]
  aulas_hoje: ScheduledClass[]
  proximas_aulas: ScheduledClass[]
  alunos: TeacherStudentRow[]
  semana: Array<{ rotulo: string; aulas: number }>
  hoje: string
}

// ---------- Atividades da turma e chaveamento de competições ----------
export type BracketFormat = 'mata_mata' | 'pontos_corridos'
/** aguardando: a team is still unknown · bye: advanced without playing. */
export type BracketMatchStatus = 'aguardando' | 'pendente' | 'finalizada' | 'bye'
export type ParticipantOrigin = 'interesse' | 'professor'
export interface PersonRef { id: string; nome: string }
export interface BracketTeam {
  id: string
  nome: string
  total_membros: number
  /** The signed-in student plays for this team. */
  meu_time: boolean
  /** Teachers get every team's members; a student only their own team's. */
  membros?: PersonRef[]
}
export interface BracketMatch {
  id: string
  rodada: number
  posicao: number
  time_a_id: string | null
  time_b_id: string | null
  placar_a: number | null
  placar_b: number | null
  vencedor_id: string | null
  status: BracketMatchStatus
}
export interface StandingRow {
  posicao: number
  time_id: string
  nome: string
  jogos: number
  vitorias: number
  empates: number
  derrotas: number
  pontos_pro: number
  pontos_contra: number
  saldo: number
  pontos: number
}
export interface ActivityBracket {
  formato: BracketFormat
  versao: number
  times: BracketTeam[]
  partidas: BracketMatch[]
  classificacao: StandingRow[]
  campeao_id: string | null
  total_rodadas: number
}
export interface ActivitySummary {
  id: string
  turma_id: string
  turma_nome: string | null
  modalidade: string | null
  titulo: string
  descricao: string | null
  /** Calendar date YYYY-MM-DD and wall-clock HH:MM, not instants. */
  data: string | null
  horario: string | null
  local: string | null
  vagas: number | null
  vagas_restantes: number | null
  inscricoes_abertas: boolean
  total_participantes: number
  tem_chaveamento: boolean
  formato: BracketFormat | null
  criado_em: string
  atualizado_em: string
}
export interface ActivityParticipant extends PersonRef { origem: ParticipantOrigin }
export interface TeacherActivityDetail extends ActivitySummary {
  participantes: ActivityParticipant[]
  alunos_turma: PersonRef[]
  chaveamento: ActivityBracket | null
}
export interface TeacherActivityClass { id: string; nome: string | null; modalidade: string | null }
export interface TeacherActivities { turmas: TeacherActivityClass[]; atividades: ActivitySummary[] }
export interface StudentActivity extends Omit<ActivitySummary, 'turma_nome' | 'modalidade'> {
  inscrito: boolean
  origem: ParticipantOrigin | null
  pode_sair: boolean
  chaveamento: ActivityBracket | null
}

export type TrainingPhase = 'classificatoria' | 'oitavas' | 'quartas' | 'semifinal' | 'final'
export type MatchStatus = 'agendado' | 'em_andamento' | 'finalizado' | 'cancelado'
export type TrainingCategory = 'futsal' | 'volei' | 'basquete' | 'handebol' | 'atletismo'

export interface TrainingTeam { id: string; nome: string; sigla: string; cor?: string; logo_url?: string | null }
export interface TrainingMatch { id: string; fase: TrainingPhase; rodada: number; posicao: number; equipe_a_id: string | null; equipe_b_id: string | null; placar_a: number | null; placar_b: number | null; status: MatchStatus; data_hora: string | null; local: string | null }
export interface TrainingBracket { categoria: TrainingCategory; fase: TrainingPhase; nome: string; partidas: TrainingMatch[]; equipes: TrainingTeam[] }
export interface TrainingTournament { id: string; nome: string; ano: number; modalidade: string; categorias: TrainingBracket[]; atualizado_em: string }
