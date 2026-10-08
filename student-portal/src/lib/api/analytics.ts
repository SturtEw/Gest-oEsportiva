/** Painel de analytics de frequência (área do professor) — apenas leitura. */

import { request } from './client'

export interface AnalyticsResumo {
  alunos_hoje: number
  sessoes_hoje: number
  sessoes_7d: number
  total_sessoes: number
  tempo_medio_segundos: number | null
  tempo_medio: string | null
}

export interface DailyPoint { data: string; alunos: number; sessoes: number }
export interface HourPoint { hora: number; label: string; entradas: number; saidas: number }

export interface StudentDetail {
  aluno: { id: string; nome: string }
  mes: string
  total_sessoes: number
  total_dias: number
  sessoes: { subgrupo_id: string; subgrupo_nome?: string | null; entrada: string; saida: string | null; tempo_permanencia_segundos: number | null; auto_encerrada?: boolean }[]
}

export interface StudentSummary {
  aluno: { id: string; nome: string }
  mes_atual: { mes: string; dias_participados: number; dias_corridos: number; frequencia_pct: number }
  mes_anterior: { mes: string; dias_participados: number }
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const analyticsApi = {
  resumo: (turmaId?: string, subgroupId?: string) =>
    request<AnalyticsResumo>(`/api/analytics/resumo${qs({ turma_id: turmaId, subgrupo_id: subgroupId })}`),
  daily: (turmaId?: string, subgroupId?: string, dias = 30) =>
    request<{ dias: number; series: DailyPoint[] }>(`/api/analytics/diario${qs({ turma_id: turmaId, subgrupo_id: subgroupId, dias })}`),
  peakHours: (turmaId?: string, subgroupId?: string, dias = 30) =>
    request<{ dias: number; horas: HourPoint[]; pico: HourPoint | null }>(`/api/analytics/horarios-pico${qs({ turma_id: turmaId, subgrupo_id: subgroupId, dias })}`),
  studentDetail: (alunoId: string, mes?: string) =>
    request<StudentDetail>(`/api/analytics/aluno/${encodeURIComponent(alunoId)}/detalhado${qs({ mes })}`),
  studentSummary: (alunoId: string) =>
    request<StudentSummary>(`/api/analytics/aluno/${encodeURIComponent(alunoId)}/resumo`),
}
