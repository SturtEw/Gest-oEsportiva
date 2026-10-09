/** Student-facing endpoints: portal snapshot, ranking and question threads. */

import { request } from './client'
import type { LinkedChild, PublicMessage, RankingResponse, StudentClassDetailed, StudentPortalSnapshot } from '@/lib/types'

export const studentApi = {
  children: () => request<{ children: LinkedChild[] }>('/api/student/children'),
  portal: (alunoId?: string) => request<StudentPortalSnapshot>(`/api/student/portal${alunoId ? `?aluno_id=${encodeURIComponent(alunoId)}` : ''}`),
  ranking: (alunoId: string) => request<RankingResponse>(`/api/student/${encodeURIComponent(alunoId)}/ranking`),
  /** Multi-turmas: todas as turmas do aluno + a principal. */
  studentClasses: (alunoId?: string) =>
    request<{ turma_id: string | null; turmas: StudentClassDetailed[] }>(
      `/api/student/me/classes${alunoId ? `?aluno_id=${encodeURIComponent(alunoId)}` : ''}`,
    ),
  setRankingPreference: (participa_ranking: boolean) => request<{ participa_ranking: boolean; atualizado_em: string }>('/api/student/me/ranking-preference', { method: 'PATCH', body: JSON.stringify({ participa_ranking }) }),
  questions: (alunoId: string) => request<PublicMessage[]>(`/api/student/${encodeURIComponent(alunoId)}/questions`),
  askQuestion: (alunoId: string, texto: string) => request<PublicMessage>(`/api/student/${encodeURIComponent(alunoId)}/questions`, { method: 'POST', body: JSON.stringify({ texto }) }),
}
