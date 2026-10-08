/** Subgrupos de atividades (modalidades da turma) e check-in de presença.
 *  O tempo de permanência é calculado no back-end; o front só exibe. */

import { request } from './client'

export interface SubgroupSummary {
  id: string
  turma_id: string
  nome: string
  descricao?: string | null
  status: 'ativo' | 'inativo'
  /** Contador em tempo real de alunos "Em Aula" agora. */
  ativos: number
  alunos_ativos: { id: string; nome: string }[]
  criado_em?: string | null
  atualizado_em?: string | null
}

export interface StudentSubgroup extends SubgroupSummary {
  minha_sessao: ActiveSession | null
}

export interface ActiveSession {
  id: string
  aluno_id: string
  subgrupo_id: string
  entrada: string
  saida: string | null
  ativa: boolean
  tempo_permanencia_segundos: number | null
  tempo_permanencia: string | null
}

export interface AttendanceRecord extends ActiveSession {
  aluno_nome: string
}

export interface SubgroupInput {
  turma_id: string
  nome: string
  descricao?: string | null
  status?: 'ativo' | 'inativo'
}

const json = (method: string, body?: unknown): { method: string; body?: string } =>
  ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

// Keys are distinct from every other API module (see api.test.ts).
export const subgroupsApi = {
  // ---- Professor ----
  teacherSubgroups: () => request<{ subgrupos: SubgroupSummary[] }>('/api/subgrupos/professor'),
  createSubgroup: (payload: SubgroupInput) =>
    request<SubgroupSummary>('/api/subgrupos/professor', json('POST', payload)),
  updateSubgroup: (id: string, changes: Partial<Omit<SubgroupInput, 'turma_id'>>) =>
    request<SubgroupSummary>(`/api/subgrupos/professor/${encodeURIComponent(id)}`, json('PATCH', changes)),
  deleteSubgroup: (id: string) =>
    request<void>(`/api/subgrupos/professor/${encodeURIComponent(id)}`, json('DELETE')),
  attendanceReport: (id: string) =>
    request<{ subgrupo: { id: string; nome: string }; sessoes: AttendanceRecord[] }>(
      `/api/subgrupos/professor/${encodeURIComponent(id)}/presencas`,
    ),
  forceCheckout: (id: string, alunoId: string) =>
    request<void>(`/api/subgrupos/professor/${encodeURIComponent(id)}/presencas/${encodeURIComponent(alunoId)}`, json('DELETE')),

  // ---- Aluno ----
  studentSubgroups: (alunoId: string) =>
    request<{ subgrupos: StudentSubgroup[] }>(`/api/subgrupos/aluno/${encodeURIComponent(alunoId)}`),
  checkin: (subgroupId: string) =>
    request<{ sessao: ActiveSession; subgrupo: StudentSubgroup }>(
      `/api/subgrupos/aluno/${encodeURIComponent(subgroupId)}/checkin`,
      json('POST'),
    ),
  checkout: (subgroupId: string) =>
    request<{ sessao: ActiveSession; subgrupo: StudentSubgroup }>(
      `/api/subgrupos/aluno/${encodeURIComponent(subgroupId)}/checkout`,
      json('POST'),
    ),
}
