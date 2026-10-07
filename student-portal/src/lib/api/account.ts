/** Self-service account management: profile, avatar and danger zone. */

import { request } from './client'

export type AccountStatus = 'ativo' | 'pendente' | 'inativo' | 'reprovado'

export interface AccountAvatar {
  tipo: 'preset' | 'upload'
  avatar_id?: string
  image_base64?: string
}

export interface AccountInfo {
  id: string
  nome: string
  email: string
  tipo: 'aluno' | 'professor' | 'responsavel' | 'admin'
  status: AccountStatus
  telefone: string | null
  avatar: AccountAvatar | null
  tem_senha: boolean
}

export interface DeactivateResult {
  status: 'inativo'
  turmas_desvinculadas: number
  message: string
}

export interface DeleteResult {
  status: 'excluida'
  email_liberado: string
  message: string
}

export const accountApi = {
  accountGet: () => request<{ conta: AccountInfo }>('/api/conta'),
  accountUpdate: (payload: { nome: string; telefone?: string | null }) =>
    request<{ conta: AccountInfo; message: string }>('/api/conta', { method: 'PATCH', body: JSON.stringify(payload) }),
  setPresetAvatar: (avatar_id: string) =>
    request<{ conta: AccountInfo; message: string }>('/api/conta/avatar', { method: 'POST', body: JSON.stringify({ avatar_id }) }),
  uploadAvatar: (image_base64: string) =>
    request<{ conta: AccountInfo; message: string }>('/api/conta/avatar/upload', { method: 'POST', body: JSON.stringify({ image_base64 }) }),
  removeAvatar: () => request<{ conta: AccountInfo; message: string }>('/api/conta/avatar', { method: 'DELETE' }),
  deactivate: (senha: string) =>
    request<DeactivateResult>('/api/conta/desativar', { method: 'POST', body: JSON.stringify({ senha }) }),
  deleteAccount: (senha: string) =>
    request<DeleteResult>('/api/conta/excluir', { method: 'POST', body: JSON.stringify({ senha }) }),
}
