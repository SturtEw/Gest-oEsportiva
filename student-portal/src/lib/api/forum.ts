/** Fórum de turma (chat estilo WhatsApp) + notificações in-app. */

import { request } from './client'
import type {
  ForumClassSummary, ForumMessage, ForumMessagesResponse, MyClassesResponse, NotificationsResponse,
} from '@/lib/types'

// Keys are distinct from every other API module (see api.test.ts) — `myClasses`
// já pertence a classesApi, então o fórum usa `forumClasses`.
export const forumApi = {
  /** Turmas em que o usuário pode conversar (aluno: multi-turmas; professor: as dele). */
  forumClasses: () => request<{ classes: ForumClassSummary[] }>('/api/forum/turmas'),
  messages: (turmaId: string, options: { limit?: number; before?: string; after?: string; signal?: AbortSignal } = {}) => {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (options.before) params.set('before', options.before)
    if (options.after) params.set('after', options.after)
    return request<ForumMessagesResponse>(`/api/forum/turmas/${encodeURIComponent(turmaId)}/mensagens?${params}`, options)
  },
  sendMessage: (turmaId: string, texto: string) =>
    request<ForumMessage>(`/api/forum/turmas/${encodeURIComponent(turmaId)}/mensagens`, { method: 'POST', body: JSON.stringify({ texto }) }),
}

export const notificationsApi = {
  list: (options?: { signal?: AbortSignal }) => request<NotificationsResponse>('/api/notifications', options),
  markRead: (id: string) => request<{ id: string; lida: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  markAllRead: () => request<{ modified: number }>('/api/notifications/read-all', { method: 'POST' }),
}

/** Multi-turmas do aluno logado (área do aluno). */
export const classesApi = {
  myClasses: (alunoId?: string) =>
    request<MyClassesResponse>(`/api/student/me/classes${alunoId ? `?aluno_id=${encodeURIComponent(alunoId)}` : ''}`),
}
