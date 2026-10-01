/**
 * Google Identity (GIS) helper.
 *
 * Both the login screen and the admin workspace need an ID credential, and both used
 * to call `accounts.id.prompt()` directly. That is the "One Tap" API: it renders
 * nothing itself and only shows a UI when the browser *chooses* to allow it. When the
 * browser declines, it fires `isNotDisplayed()` / `isSkippedMoment()` and the user got
 * the dead-end message "Prompt não exibido" with no way forward.
 *
 * Real causes, all handled here:
 *
 *  1. One Tap is suppressed when the browser is already signed in to Google ("moment
 *     skipped"), in third-party-iframe contexts, and increasingly under FedCM defaults.
 *  2. `prompt()` must run inside the click handler's user-gesture window. The old code
 *     awaited a script download first, so the gesture had already expired.
 *  3. `requestAccessToken()` is NOT a substitute: it returns an OAuth *access* token,
 *     while the backend verifies a Google *ID* token. Using it would fail verification.
 *
 * The fix is `ux_mode: 'popup'` with `renderButton`: Google renders a real button, and
 * clicking it opens the account chooser, which works in every case One Tap refuses.
 *
 * Hosting note: the site runs behind a strict Content-Security-Policy, so the page must
 * allow `https://accounts.google.com` in script-src/style-src/frame-src/connect-src —
 * the GIS library and its identity iframe both come from there. `accounts.gstatic.com`
 * is deliberately NOT needed, which keeps the allow-list minimal.
 */

export interface GoogleCredentialResponse {
  credential: string
}

interface PromptMomentNotification {
  isNotDisplayed: () => boolean
  isSkippedMoment: () => boolean
}

interface GoogleIdApi {
  initialize: (options: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    ux_mode?: 'popup' | 'redirect'
    cancel_on_tap_outside?: boolean
    /** Deprecado pelo Google — aceito apenas para compatibilidade de tipos. */
    use_fedcm_for_prompt?: boolean
  }) => void
  prompt: (callback?: (notification: PromptMomentNotification) => void) => void
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void
  cancel: () => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdApi
      }
    }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let loader: Promise<GoogleIdApi> | null = null

/**
 * Google's `initialize()` accepts only ONE callback per page — calling it again
 * replaces the previous instance and logs "initialize() is called multiple times".
 * Both the rendered button and the One Tap probe need to receive credentials, so we
 * initialize exactly once per client id and dispatch through a swappable handler.
 */
let initializedClientId: string | null = null
let credentialHandler: ((credential: string) => void) | null = null

function ensureInitialized(api: GoogleIdApi, clientId: string): void {
  if (initializedClientId === clientId) return
  initializedClientId = clientId
  api.initialize({
    client_id: clientId,
    ux_mode: 'popup',
    cancel_on_tap_outside: true,
    // `use_fedcm_for_prompt` foi DEPRECADO pelo Google e hoje é ignorado; o
    // navegador decide o fluxo sozinho. Mantê-lo aqui só gerava ruído no
    // console (GSI_LOGGER: FedCM migration) sem efeito prático.
    callback: (response) => {
      // Deliver even an empty credential: the mounted handler decides what to do
      // (report an error) instead of hanging silently.
      if (credentialHandler) credentialHandler(response?.credential ?? '')
    },
  })
}

/** Load the GIS script once and resolve the `google.accounts.id` namespace. */
export function loadGoogleIdentity(): Promise<GoogleIdApi> {
  const ready = window.google?.accounts?.id
  if (ready) return Promise.resolve(ready)
  if (loader) return loader

  loader = new Promise<GoogleIdApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.onload = () => {
      const api = window.google?.accounts?.id
      if (api) {
        resolve(api)
        return
      }
      loader = null
      reject(new GoogleAuthError('O Google carregou, mas não expôs a API de identidade. Recarregue a página.'))
    }
    script.onerror = () => {
      loader = null
      reject(new GoogleAuthError('Não foi possível carregar o serviço do Google. Verifique a conexão e bloqueadores de popup.'))
    }
    document.head.appendChild(script)
  })

  return loader
}

export class GoogleAuthError extends Error {
  /** False when retrying cannot help (e.g. missing client id) and the UI should not offer it. */
  readonly retryable: boolean

  constructor(message: string, retryable = true) {
    super(message)
    this.name = 'GoogleAuthError'
    this.retryable = retryable
  }
}

export interface GoogleButtonHandle {
  /** Detach the rendered button and release Google's callback. */
  destroy: () => void
}

/**
 * Render Google's own account-chooser button into `container`.
 *
 * The handle resolves as soon as the button is on screen; the credential arrives later
 * through `onCredential`, called at most once per mount. Preload the script with
 * `loadGoogleIdentity()` on mount so the first click does not wait on the network and
 * stays inside the browser's user-gesture window.
 */
export async function mountGoogleSignInButton(options: {
  clientId: string
  container: HTMLElement
  onCredential: (credential: string) => void | Promise<void>
  text?: 'signin_with' | 'signup_with' | 'continue_with'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  onError?: (cause: unknown) => void
}): Promise<GoogleButtonHandle> {
  const { clientId, container, onCredential, text = 'continue_with', theme = 'outline', shape = 'pill', onError } = options
  if (!clientId) throw new GoogleAuthError('O acesso com Google ainda não está configurado pela escola.', false)

  const api = await loadGoogleIdentity()
  let released = false

  ensureInitialized(api, clientId)
  let delivered = false
  const handler = (credential: string) => {
    // Google may invoke the shared callback more than once per mount; the
    // component must act on the credential at most once.
    if (delivered) return
    delivered = true
    if (!credential) {
      onError?.(new GoogleAuthError('O Google não retornou uma credencial válida. Tente novamente.'))
      return
    }
    void Promise.resolve(onCredential(credential)).catch((cause: unknown) => onError?.(cause))
  }
  credentialHandler = handler

  const release = () => {
    if (released) return
    released = true
    try { api.cancel() } catch { /* optional in some stubbed environments */ }
    container.replaceChildren()
    // The button owns the callback while mounted; drop it so a later probe or
    // re-mount does not deliver credentials into a released component.
    if (credentialHandler === handler) credentialHandler = null
  }

  return new Promise<GoogleButtonHandle>((resolve, reject) => {
    try {
      api.renderButton(container, {
        type: 'standard',
        theme,
        size: 'large',
        text,
        shape,
        width: Math.max(200, container.clientWidth || 320),
        logo_alignment: 'left',
      })
      resolve({ destroy: release })
    } catch (cause) {
      const wrapped = cause instanceof Error ? cause : new GoogleAuthError('Falha ao exibir o botão do Google.')
      onError?.(wrapped)
      reject(wrapped)
    }
  })
}

/**
 * Diagnostic: report whether One Tap is viable, so the UI can explain itself instead of
 * showing a dead end. Resolves `{ available: false }` rather than throwing.
 */
export function probeOneTap(clientId: string): Promise<{ available: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (!clientId) {
      resolve({ available: false, reason: 'client_id ausente' })
      return
    }
    loadGoogleIdentity().then((api) => {
      let done = false
      const finish = (available: boolean, reason?: string) => {
        if (done) return
        done = true
        // Restore the button's callback if one was registered before the probe ran.
        if (previousHandler) credentialHandler = previousHandler
        resolve({ available, reason })
      }
      const previousHandler = credentialHandler
      // One Tap's "moment" is short; silence means it will not render.
      window.setTimeout(() => finish(false, 'sem resposta do Google no prazo'), 1200)
      try {
        // Reuse the single shared initialize() for this client id and just swap
        // the credential handler for the duration of the probe.
        ensureInitialized(api, clientId)
        credentialHandler = () => finish(false, 'credencial automática')
        api.prompt((notification) => {
          if (notification.isSkippedMoment?.()) finish(false, 'usuário já conectado ao Google neste navegador')
          else if (notification.isNotDisplayed?.()) finish(false, 'contexto não permitido (iframe, fedcmdm ou cookies de terceiros)')
        })
      } catch (cause) {
        finish(false, cause instanceof Error ? cause.message : 'erro ao consultar o prompt')
      }
    }).catch((cause: unknown) => {
      resolve({ available: false, reason: cause instanceof Error ? cause.message : 'falha ao carregar o Google' })
    })
  })
}
