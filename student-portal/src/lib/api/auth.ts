/** Authentication, session and account endpoints. */

import { request, setCsrfToken } from './client'
import type { SessionUser } from '@/lib/types'

export type AccountStatusResponse = 'ativo' | 'pendente' | 'reprovado' | 'inativo'

export interface RegisterInput {
  provider: 'email' | 'google'
  credential?: string
  nome: string
  email: string
  senha?: string
  /** Cadastro público existe apenas para aluno; professor entra por convite. */
  tipo: 'aluno'
  data_nascimento?: string
  documento_tipo: 'cpf' | 'rg' | 'outro'
  documento_numero: string
}

export const authApi = {
  session: (options?: { signal?: AbortSignal }) => request<{ user: SessionUser }>('/api/auth/me', options),
  // Devolve também o token CSRF: em deploys cross-origin o JS não lê o cookie
  // gesp_csrf, então o token precisa vir no corpo da resposta.
  googleConfig: async () => {
    const config = await request<{ client_id: string | null; csrf_token?: string }>('/api/auth/google-config')
    setCsrfToken(config.csrf_token)
    return config
  },
  // O cargo é identificado pelo backend a partir do e-mail; não enviamos mais
  // a área escolhida na interface.
  login: (login: string, senha: string) => request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, senha }) }),
  googleLogin: (credential: string) => request<{ user: SessionUser }>('/api/auth/google-login', { method: 'POST', body: JSON.stringify({ credential }) }),
  googleLink: (credential: string) => request<{ google_linked: boolean; google_email: string; user_id: string }>('/api/auth/google-link', { method: 'POST', body: JSON.stringify({ credential }) }),
  googleUnlink: () => request<void>('/api/auth/google-unlink', { method: 'POST' }),
  forgotPassword: (email: string) => request<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, new_password: string) => request<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password }) }),
  changePassword: (current_password: string, new_password: string) => request<{ message: string }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  register: (payload: RegisterInput) => request<{ status: AccountStatusResponse; requires_approval: boolean; user: SessionUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
}