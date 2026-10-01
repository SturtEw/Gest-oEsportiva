/**
 * Low-level HTTP transport shared by all API domain modules.
 *
 * Handles base URL resolution, CSRF header injection for mutating requests,
 * impersonation header for admin "View As" feature, and error normalisation.
 */

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const CSRF_COOKIE = 'gesp_csrf'
const CSRF_HEADER = 'X-CSRF-Token'
const IMPERSONATE_HEADER = 'X-Impersonate-Role'
const IMPERSONATE_TARGET_HEADER = 'X-Impersonate-Target'
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS'])

let getImpersonation: () => { role: string; targetId: string } | null = () => null
export function setImpersonationGetter(getter: () => { role: string; targetId: string } | null) {
  getImpersonation = getter
}

// Token CSRF entregue pela API no corpo de /api/auth/google-config. Em deploys
// cross-origin o JS nao consegue ler o cookie gesp_csrf (dominio diferente),
// entao usamos este valor como fallback para o header X-CSRF-Token.
let csrfTokenFromApi: string | null = null
export function setCsrfToken(token: string | null | undefined) {
  csrfTokenFromApi = typeof token === 'string' && token.includes('.') ? token : null
}
function resolveCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE) ?? csrfTokenFromApi
}

export class ApiError extends Error {
  status: number
  traceId?: string
  constructor(message: string, status: number, traceId?: string) { super(message); this.name = 'ApiError'; this.status = status; this.traceId = traceId }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${encodeURIComponent(name)}=`
  const parts = document.cookie ? document.cookie.split('; ') : []
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      try { return decodeURIComponent(part.slice(prefix.length)) } catch { return null }
    }
  }
  return null
}

export async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const { signal, ...restInit } = init
  const headers = new Headers(restInit.headers)
  if (restInit.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const method = (restInit.method ?? 'GET').toUpperCase()
  if (!IDEMPOTENT.has(method)) {
    const csrf = resolveCsrfToken()
    if (csrf) headers.set(CSRF_HEADER, csrf)
  }
  // Auth endpoints must always use the real actor. A view is read-only on the API.
  headers.delete(IMPERSONATE_HEADER)
  headers.delete(IMPERSONATE_TARGET_HEADER)
  const view = getImpersonation()
  if (view && !path.startsWith('/api/auth/')) {
    if (!IDEMPOTENT.has(method)) throw new ApiError('A visualização como outro perfil é somente leitura.', 403)
    headers.set(IMPERSONATE_HEADER, view.role)
    headers.set(IMPERSONATE_TARGET_HEADER, view.targetId)
  }
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...restInit, headers, credentials: 'include', cache: 'no-store', signal })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError('Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.', 0)
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  // Hosting sem backend devolve o HTML do SPA (content-type text/html, status 200)
  // para qualquer /api/*: sem este guard o cliente interpreta HTML como payload
  // e mostra "Nao foi possivel verificar sua sessao" em vez de um estado offline.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError('Serviço indisponível: o backend não está conectado a este deploy.', response.status === 200 ? 503 : response.status)
  }
  if (!response.ok) throw new ApiError(payload?.detail ?? payload?.message ?? 'Não foi possível concluir esta ação.', response.status, payload?.traceId)
  return payload as T
}
