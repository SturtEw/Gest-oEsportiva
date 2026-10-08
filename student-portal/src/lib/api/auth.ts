/** Authentication, session and account endpoints. */

import { request, setCsrfToken } from './client'
import type { InviteClassBrief, JoinedClass, SessionUser, TeacherInvitePreview } from '@/lib/types'

export type AccountStatusResponse = 'ativo' | 'pendente' | 'reprovado' | 'inativo'

export interface GoogleConfig { client_id: string | null; csrf_token?: string }

// The client id never changes during a page's lifetime, yet the login screen and
// the admin workspace each asked for it on every mount (and the admin on every
// realtime refresh). One shared promise serves them all; a failure is not cached,
// so the next caller retries.
let googleConfigRequest: Promise<GoogleConfig> | null = null

function loadGoogleConfig(): Promise<GoogleConfig> {
  googleConfigRequest ??= request<GoogleConfig>('/api/auth/google-config')
    .then((config) => {
      setCsrfToken(config.csrf_token)
      return config
    })
    .catch((cause: unknown) => {
      googleConfigRequest = null
      throw cause
    })
  return googleConfigRequest
}

/** Test hook: forget the cached google-config response. */
export function resetGoogleConfigCache() {
  googleConfigRequest = null
}

export interface RegisterInput {
  provider: 'email' | 'google'
  credential?: string
  nome: string
  email: string
  senha?: string
  /** Cadastro público existe apenas para aluno; professor entra por convite. */
  tipo: 'aluno'
  data_nascimento?: string
  documento_tipo?: 'cpf' | 'rg' | 'outro'
  documento_numero?: string
  /** Optional teacher invite: the new student enters that class directly. */
  codigo_convite?: string
}

export interface RegisterResponse {
  status: AccountStatusResponse
  requires_approval: boolean
  user: SessionUser
  /** Class joined through `codigo_convite`, when one was sent and accepted. */
  turma?: JoinedClass | null
  /** Set when the account was created but the invite could not be applied. */
  aviso_convite?: string | null
  /** Verification email delivery result (backend A3 fix); undefined for Google signups. */
  email_enviado?: boolean
  email_erro?: string | null
}

/** Signup through the root admin's invite link. The e-mail comes from the invite. */
export interface TeacherRegisterInput {
  token: string
  provider: 'email' | 'google'
  credential?: string
  nome: string
  senha?: string
  documento_tipo?: 'cpf' | 'rg' | 'outro'
  documento_numero?: string
  formacao_academica: string
  area_atuacao: string
}

export interface TeacherRegisterResponse {
  user: SessionUser
  /** Class handed over by the invite, when it was still free. */
  turma: InviteClassBrief | null
  /** Set when the account exists but the invited class could not be assigned. */
  aviso: string | null
}

export const authApi = {
  session: (options?: { signal?: AbortSignal }) => request<{ user: SessionUser }>('/api/auth/me', options),
  // Devolve também o token CSRF: em deploys cross-origin o JS não lê o cookie
  // gesp_csrf, então o token precisa vir no corpo da resposta.
  googleConfig: loadGoogleConfig,
  // O cargo é identificado pelo backend a partir do e-mail; não enviamos mais
  // a área escolhida na interface.
  login: (login: string, senha: string) => request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, senha }) }),
  googleLogin: (credential: string) => request<{ user: SessionUser }>('/api/auth/google-login', { method: 'POST', body: JSON.stringify({ credential }) }),
  googleLink: (credential: string) => request<{ google_linked: boolean; google_email: string; user_id: string }>('/api/auth/google-link', { method: 'POST', body: JSON.stringify({ credential }) }),
  googleUnlink: () => request<void>('/api/auth/google-unlink', { method: 'POST' }),
  forgotPassword: (email: string) => request<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, new_password: string) => request<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password }) }),
  changePassword: (current_password: string, new_password: string) => request<{ message: string }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  register: (payload: RegisterInput) => request<RegisterResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  teacherInvitePreview: (token: string) => request<TeacherInvitePreview>(`/api/auth/teacher-invite?token=${encodeURIComponent(token)}`),
  registerTeacher: (payload: TeacherRegisterInput) => request<TeacherRegisterResponse>('/api/auth/register-teacher', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
}