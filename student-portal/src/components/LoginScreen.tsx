// Bootstrap ships with the login chunk (and TeacherInviteScreen, which reuses
// AuthShell), not with the logged-in areas. Layer order: styles/layers.css.
import '@/styles/bootstrap-theme.scss'
import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Eye, EyeOff,
  LockKeyhole, Mail, ShieldCheck, Sparkles, Ticket, User,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { GoogleAuthError, loadGoogleIdentity, mountGoogleSignInButton, type GoogleButtonHandle } from '@/lib/google-identity'
import { clearInviteFromLocation, formatInviteCode, inviteCodeFromLocation, isCompleteInviteCode, normalizeInviteCode } from '@/lib/invite-code'
import type { AccountStatus, SessionUser } from '@/lib/types'
import heroImage from '@/assets/hero.png'

interface Props {
  error: string | null
  onLogin: (login: string, senha: string) => Promise<SessionUser>
  onGoogleLogin: (credential: string) => Promise<SessionUser>
  onRegistrationActive: (user: SessionUser) => void
  onClearError: () => void
}

type FormMode = 'login' | 'register' | 'forgot'

// ==========================================================================
//  Componentes pequenos reutilizáveis (Bootstrap)
// ==========================================================================


interface FloatingLabelInputProps {
  label: string
  type?: string
  value: string
  onValueChange: (value: string) => void
  icon?: ComponentType<{ className?: string }>
  showPassword?: boolean
  onTogglePassword?: () => void
  className?: string
  invalid?: boolean
}

export function FloatingLabelInput({
  label,
  type = 'text',
  value,
  onValueChange,
  icon: Icon,
  showPassword,
  onTogglePassword,
  className,
  invalid,
  ...props
}: FloatingLabelInputProps & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'className'>) {
  const inputType = (showPassword !== undefined && onTogglePassword)
    ? (showPassword ? 'text' : 'password')
    : type
  return (
    <div className={`form-floating-ge ${className ?? ''}`}>
      {Icon && (
        <span className="input-icon-start" aria-hidden="true">
          <Icon className="w-5 h-5" />
        </span>
      )}
      <input
        type={inputType}
        value={value}
        onChange={(e) => { onValueChange(e.target.value) }}
        className={`form-control ${invalid ? 'is-invalid' : ''}`}
        data-invalid={invalid ? 'true' : undefined}
        placeholder=" "
        {...props}
      />
      <label htmlFor={props.id}>{label}</label>
      {showPassword !== undefined && onTogglePassword && (
        <button
          type="button"
          className="input-icon-end link-secondary"
          onClick={onTogglePassword}
          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {showPassword ? <EyeOff aria-hidden="true" className="w-5 h-5" /> : <Eye aria-hidden="true" className="w-5 h-5" />}
        </button>
      )}
    </div>
  )
}

// ==========================================================================
//  Tela principal
// ==========================================================================

export function LoginScreen({ error, onLogin, onGoogleLogin, onRegistrationActive, onClearError }: Props) {
  // A teacher's signup link (?convite=CODE) opens straight on the student signup.
  const [mode, setMode] = useState<FormMode>(() => (inviteCodeFromLocation() ? 'register' : 'login'))
  const [inviteCode, setInviteCode] = useState(() => inviteCodeFromLocation())
  const [accountState, setAccountState] = useState<{status: AccountStatus; name: string; email: string; message?: string} | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? null)
  const [googleConfigLoaded, setGoogleConfigLoaded] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleHandleRef = useRef<GoogleButtonHandle | null>(null)
  const [provider, setProvider] = useState<'email' | 'google'>('email')
  const [googleToken, setGoogleToken] = useState<string | null>(null)

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [documentType, setDocumentType] = useState<'cpf' | 'rg' | 'outro' | ''>('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSuccess, setForgotSuccess] = useState(false)

  useEffect(() => {
    let active = true
    api.googleConfig().then(({ client_id }) => {
      if (active && client_id) setGoogleClientId(client_id)
    }).catch(() => undefined).finally(() => { if (active) setGoogleConfigLoaded(true) })
    return () => { active = false }
  }, [])

  // Warm the GIS script in the background, but never let it gate the page: in a gym
  // with poor connectivity a hanging accounts.google.com request delayed the window
  // load event by ~70s, which froze the login experience. Requesting with lower
  // priority and no await keeps the button warm without holding the page hostage.
  useEffect(() => {
    if (!googleClientId) return
    const idle = window.setTimeout(() => { void loadGoogleIdentity().catch(() => undefined) }, 1500)
    return () => window.clearTimeout(idle)
  }, [googleClientId])

  // One Tap (o prompt automático) foi removido do fluxo: ele exige que a origem
  // esteja autorizada na credencial Google e, quando recusado, disparava um 403
  // em accounts.google.com. O botão oficial abaixo é o único caminho — funciona
  // em qualquer contexto e é o que o backend consegue verificar.

  // Render Google's own button. It opens a real account chooser popup, which works in
  // every context where One Tap silently refuses to draw anything.
  useEffect(() => {
    const container = googleButtonRef.current
    if (!container || !googleClientId) return
    let active = true
    googleHandleRef.current?.destroy()
    googleHandleRef.current = null

    void mountGoogleSignInButton({
      clientId: googleClientId,
      container,
      onCredential: (credential) => { void handleGoogleCredential(credential) },
      text: mode === 'register' ? 'signup_with' : 'continue_with',
      onError: (cause: unknown) => {
        if (!active) return
        setLocalError(cause instanceof Error ? cause.message : 'Não foi possível entrar com Google.')
        setGoogleLoading(false)
      },
    })
      .then((handle) => {
        if (!active) { handle.destroy(); return }
        googleHandleRef.current = handle
      })
      .catch((cause: unknown) => {
        if (!active) return
        setLocalError(cause instanceof GoogleAuthError ? cause.message : 'Não foi possível carregar o acesso com Google.')
      })

    return () => {
      active = false
      googleHandleRef.current?.destroy()
      googleHandleRef.current = null
    }
  }, [googleClientId, mode])

  const handleGoogleCredential = async (credential: string) => {
    if (!credential) return
    setLoading(true)
    setGoogleLoading(true)
    setLocalError(null)
    onClearError()
    try {
      if (mode === 'login') {
        const user = await onGoogleLogin(credential)
        if (user.status === 'pendente' || user.status === 'reprovado') {
          setAccountState({ status: user.status, name: user.nome, email: user.email })
        }
      } else {
        setGoogleToken(credential)
        setProvider('google')
        setLocalError(null)
      }
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Não foi possível validar a conta Google.')
    } finally {
      setLoading(false)
      setGoogleLoading(false)
    }
  }

  const resetFeedback = () => { setLocalError(null); onClearError(); setAccountState(null) }
  const resetRegistration = () => { setMode('login'); setProvider('email'); setGoogleToken(null); setForgotSuccess(false); resetFeedback() }

  const submitForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!forgotEmail.trim()) { setLocalError('Informe o e-mail da sua conta.'); return }
    setForgotLoading(true); resetFeedback()
    try {
      // Success means the BACKEND confirmed the send (HTTP 200). A 502 means the
      // e-mail did not leave — the ApiError message is shown, never a success screen.
      await api.forgotPassword(forgotEmail.trim())
      setForgotSuccess(true)
    } catch (cause) {
      setForgotSuccess(false)
      if (cause instanceof ApiError) setLocalError(cause.message)
      else setLocalError(cause instanceof Error ? cause.message : 'Não foi possível enviar o e-mail de recuperação.')
    } finally { setForgotLoading(false) }
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!identifier.trim() || !password) { setLocalError('Informe seu e-mail e a senha.'); return }
    setLoading(true); resetFeedback()
    try {
      const user = await onLogin(identifier.trim(), password)
      if (user.status === 'pendente' || user.status === 'reprovado') {
        setAccountState({
          status: user.status, name: user.nome, email: user.email,
          message: user.status === 'reprovado'
            ? 'Entre em contato com a escola para saber como prosseguir.'
            : undefined,
        })
      }
    } catch (cause) {
      if (cause instanceof ApiError) setLocalError(cause.message)
      else setLocalError(cause instanceof Error ? cause.message : 'Não foi possível entrar.')
    } finally { setLoading(false) }
  }

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inviteCode && !isCompleteInviteCode(inviteCode)) {
      setLocalError('O código de convite tem 8 caracteres. Confira o código ou deixe o campo em branco.')
      return
    }
    setLoading(true); resetFeedback()
    try {
      // O cadastro público cria somente alunos. Contas de professor são
      // provisionadas por convite do administrador raiz.
      const result = await api.register({
        provider,
        ...(provider === 'google' && googleToken ? { credential: googleToken } : {}),
        nome: fullName.trim(),
        email: email.trim(),
        ...(provider === 'email' ? { senha: password } : {}),
        tipo: 'aluno',
        data_nascimento: birthDate,
        documento_tipo: documentType || undefined,
        documento_numero: documentType ? documentNumber : undefined,
        ...(inviteCode ? { codigo_convite: inviteCode } : {}),
      })
      setGoogleToken(null)
      clearInviteFromLocation()
      if (result.turma) toast.success(`Conta criada! Você já faz parte da turma ${result.turma.nome}.`)
      else if (result.aviso_convite) toast.warning(result.aviso_convite)
      if (result.user && result.status === 'ativo') onRegistrationActive(result.user)
      else setAccountState({
        status: 'pendente',
        name: fullName.trim(),
        email: email.trim(),
        message: 'Seu cadastro foi enviado para aprovação. Você poderá entrar após a validação da escola.',
      })
    } catch (cause) {
      setGoogleToken(null)
      setProvider('email')
      setLocalError(cause instanceof Error ? cause.message : 'Não foi possível enviar seu cadastro.')
    } finally { setLoading(false) }
  }

  // ======= Estados de feedback pós-login/cadastro =========================
  if (accountState) {
    const isPending = accountState.status === 'pendente'
    const isRejected = accountState.status === 'reprovado'
    const isActive = accountState.status === 'ativo'
    return (
      <AuthShell>
        <div className="d-flex flex-column align-items-center">
          <div
            className={`d-flex align-items-center justify-content-center rounded-4 ${
              isRejected ? 'text-danger' : 'text-ge-success'
            }`}
            style={{ width: 56, height: 56, backgroundColor: isRejected ? '#FFF0E9' : '#EAF0E5' }}
          >
            <ShieldCheck aria-hidden="true" style={{ width: 28, height: 28 }} />
          </div>
          <p className="mt-6 mb-0 text-ge-success fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.14em' }}>
            {isPending ? 'Cadastro em análise' : isRejected ? 'Atualização da conta' : 'Conta criada'}
          </p>
          <h1 className="type-title text-center mt-2 mb-0" style={{ fontSize: 30, fontWeight: 800, color: '#18372F' }}>
            {isPending ? 'Aguardando aprovação' : isRejected ? 'Cadastro não aprovado' : 'Conta criada'}
          </h1>
          <p className="mt-4 text-center mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 420 }}>
            {accountState.message ?? (
              isPending
                ? `O cadastro de ${accountState.name} será analisado pelo administrador. Você receberá uma atualização quando houver uma decisão.`
                : isRejected
                  ? `Olá, ${accountState.name}. ${accountState.message ?? 'Entre em contato com a escola para saber como prosseguir.'}`
                  : 'Seu acesso está liberado.'
            )}
          </p>
          <div className="mt-6 rounded-3 bg-ge-light p-4 text-center w-100">
            <p className="mb-1 text-ge-muted" style={{ fontSize: 12 }}>Conta</p>
            <p className="mb-0 fw-semibold">{accountState.email}</p>
          </div>
          {isActive && (
            <button
              type="button"
              className="btn btn-ge-primary mt-6 d-flex align-items-center justify-content-center gap-2 w-100 fw-bold"
              style={{ height: 44 }}
              onClick={resetRegistration}
            >
              Entrar na área do aluno
              <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary mt-2 w-100 d-flex align-items-center justify-content-center gap-2 border-0"
            style={{ borderRadius: 16 }}
            onClick={resetRegistration}
          >
            <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
            Voltar para entrar
          </button>
        </div>
      </AuthShell>
    )
  }

  // ======= Formulário principal ===========================================
  return (
    <AuthShell>
      <div className="text-center mb-12">
        <p className="mb-4 d-inline-flex align-items-center gap-2 text-ge-success fw-bold text-uppercase"
           style={{ fontSize: 11, letterSpacing: '0.14em' }}>
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16 }} />
          Acesso seguro
        </p>
        <h1 className="type-title mb-0" style={{ fontSize: 34, fontWeight: 800, color: '#18372F' }}>
          Seu percurso começa aqui.
        </h1>
        <p className="mx-auto mt-4 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 440 }}>
          Entre com seu e-mail e senha. Identificamos automaticamente se você é aluno ou professor.
        </p>
      </div>

      <div className="rounded-3 border px-6 py-4" style={{ borderColor: '#E1E9DB', backgroundColor: '#F7FAF4', color: '#536A58', fontSize: 12, lineHeight: 1.6 }}>
        Professores recebem o acesso por convite do administrador. Alunos podem criar a própria conta.
      </div>

      {(localError || error) && (
        <div className="alert alert-danger mt-6 d-flex align-items-start gap-2 rounded-3" role="alert">
          <span className="mt-1 d-flex">
            <ShieldCheck aria-hidden="true" style={{ width: 18, height: 18 }} />
          </span>
          <div className="flex-grow-1" style={{ fontSize: 14 }}>{localError ?? error}</div>
        </div>
      )}

      {mode === 'login' ? (
        <form className="mt-12 d-grid gap-4" onSubmit={(event) => void submitLogin(event)} noValidate>
          <FloatingLabelInput
            id="login-email"
            label="E-mail"
            type="email"
            autoComplete="username"
            required
            value={identifier}
            onValueChange={setIdentifier}
            placeholder="nome@email.com"
            icon={Mail}
          />
          <FloatingLabelInput
            id="login-password"
            label="Senha"
            autoComplete="current-password"
            required
            value={password}
            onValueChange={setPassword}
            icon={LockKeyhole}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((v) => !v)}
          />
          <button
            type="submit"
            disabled={loading}
            className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1"
            style={{ height: 48 }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
            <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
          <div className="d-flex justify-content-end">
            <button
              type="button"
              className="btn btn-link p-0 fw-medium text-decoration-none text-ge-primary"
              style={{ fontSize: 13 }}
              onClick={() => { setMode('forgot'); setForgotEmail(identifier.trim()); setForgotSuccess(false); resetFeedback() }}
            >
              Esqueci minha senha
            </button>
          </div>
        </form>
      ) : mode === 'forgot' ? (
        forgotSuccess ? (
          <div className="mt-12 d-flex flex-column align-items-center">
            <div
              className="d-flex align-items-center justify-content-center rounded-4 text-ge-success mb-6"
              style={{ width: 56, height: 56, backgroundColor: '#EAF0E5' }}
            >
              <CheckCircle2 aria-hidden="true" style={{ width: 28, height: 28 }} />
            </div>
            <h2 className="type-title mb-0 text-center" style={{ fontSize: 22, fontWeight: 800, color: '#18372F' }}>
              Verifique sua caixa de entrada
            </h2>
            <p className="mt-4 mb-0 text-center text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Se houver uma conta associada a <span className="fw-semibold text-dark">{forgotEmail || 'este e-mail'}</span>,
              enviamos um link para redefinir a senha. O link expira em 60 minutos.
            </p>
            <div className="mt-12 d-flex flex-column w-100 gap-2">
              <button
                type="button"
                className="btn btn-ge-outline w-100 d-flex align-items-center justify-content-center gap-2 fw-medium"
                style={{ borderRadius: 16 }}
                onClick={() => { setMode('login'); setForgotSuccess(false); resetFeedback() }}
              >
                <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
                Voltar para entrar
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-12 d-grid gap-4" onSubmit={(event) => void submitForgotPassword(event)} noValidate>
            <h2 className="mb-0" style={{ fontSize: 18, fontWeight: 700, color: '#18372F' }}>
              Recuperar acesso
            </h2>
            <p className="mb-0 text-ge-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              Informe o e-mail cadastrado. Enviaremos um link seguro para você criar uma nova senha.
            </p>
            <FloatingLabelInput
              id="forgot-email"
              label="E-mail da conta"
              type="email"
              autoComplete="email"
              required
              value={forgotEmail}
              onValueChange={setForgotEmail}
              placeholder="nome@email.com"
              icon={Mail}
            />
            <button
              type="submit"
              disabled={forgotLoading}
              className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1"
              style={{ height: 48 }}
            >
              {forgotLoading ? 'Enviando…' : 'Enviar link de recuperação'}
              <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-2 border-0 text-ge-muted"
              style={{ borderRadius: 16 }}
              onClick={() => { setMode('login'); setForgotSuccess(false); resetFeedback() }}
            >
              <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
              Voltar para entrar
            </button>
          </form>
        )
      ) : (
        <form className="mt-12 d-grid gap-4" onSubmit={(event) => void submitRegistration(event)} noValidate>
          {provider === 'google' && googleToken && (
            <div className="alert alert-success rounded-3 d-flex align-items-start gap-2" role="alert"
                 style={{ backgroundColor: '#F5FAF1', borderColor: '#D8E5CF', color: '#183C32' }}>
              <CheckCircle2 aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }} />
              <div className="flex-grow-1" style={{ fontSize: 14 }}>
                Conta Google verificada. Complete os dados exigidos pela escola.
              </div>
            </div>
          )}

          <FloatingLabelInput
            id="signup-name"
            label="Nome completo"
            autoComplete="name"
            required
            minLength={3}
            maxLength={120}
            value={fullName}
            onValueChange={setFullName}
            icon={User}
          />
          <FloatingLabelInput
            id="signup-email"
            label="E-mail"
            type="email"
            autoComplete="email"
            required
            value={email}
            onValueChange={setEmail}
            placeholder="nome@email.com"
            icon={Mail}
          />
          {provider === 'email' && (
            <div>
              <FloatingLabelInput
                id="signup-password"
                label="Senha"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={72}
                value={password}
                onValueChange={setPassword}
                icon={LockKeyhole}
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword((v) => !v)}
              />
              <div className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>
                Mínimo de 10 caracteres.
              </div>
            </div>
          )}

          <FloatingLabelInput
            id="birth-date"
            label="Data de nascimento"
            type="date"
            required
            autoComplete="bday"
            value={birthDate}
            onValueChange={setBirthDate}
            icon={CalendarDays}
          />

          <div className="row g-3">
            <div className="col-5">
              <label htmlFor="document-type" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>
                Documento <span aria-hidden="true" className="text-muted">(opcional)</span>
              </label>
              <select
                id="document-type"
                className="form-select"
                value={documentType}
                onChange={(event) => {
                  const v = event.target.value
                  if (v === 'cpf' || v === 'rg' || v === 'outro' || v === '') setDocumentType(v)
                }}
                style={{ height: 51, borderRadius: 14 }}
              >
                <option value="">Não informar</option>
                <option value="cpf">CPF</option>
                <option value="rg">RG</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div className="col-7">
              <label htmlFor="document-number" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>
                Número {documentType ? <span aria-hidden="true" className="text-danger">*</span> : <span aria-hidden="true" className="text-muted">(opcional)</span>}
              </label>
              <input
                id="document-number"
                type="text"
                required={Boolean(documentType)}
                disabled={!documentType}
                minLength={documentType ? 5 : undefined}
                maxLength={40}
                autoComplete="off"
                value={documentNumber}
                onChange={(event) => setDocumentNumber(event.target.value)}
                placeholder={documentType ? "Somente número ou letras" : "Escolha um tipo para informar"}
                className="form-control"
                style={{ height: 51, borderRadius: 14 }}
              />
              <div className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>
                Opcional. Se informado, o documento fica protegido — nunca é exibido por completo.
              </div>
            </div>
          </div>

          <div>
            <FloatingLabelInput
              id="signup-invite-code"
              label="Código de convite (opcional)"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
              value={formatInviteCode(inviteCode)}
              onValueChange={(value) => setInviteCode(normalizeInviteCode(value))}
              icon={Ticket}
              aria-describedby="signup-invite-help"
              className="font-monospace"
            />
            <div id="signup-invite-help" className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>
              {isCompleteInviteCode(inviteCode)
                ? 'Com este código você entra direto na turma do professor.'
                : 'Recebeu um código do professor? Digite aqui. Sem código, você procura sua turma depois do cadastro.'}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || (provider === 'google' && !googleToken)}
            className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1"
            style={{ height: 48 }}
          >
            {loading ? 'Enviando cadastro…' : 'Criar conta de aluno'}
            <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
        </form>
      )}

      {mode !== 'forgot' && (
        <>
          {/* ---------- Divisor + Google ------------------------------------------ */}
          <div className="mt-12">
            <p className="hr-or mb-0">ou continue com</p>
            {/* Google injects its own iframe here, so this node must stay empty of ours. */}
            <div
              ref={googleButtonRef}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center"
              style={{ minHeight: 48 }}
            />
            {googleLoading && (
              <p className="mt-4 mb-0 text-center text-ge-muted" style={{ fontSize: 13 }} role="status">
                Validando sua conta Google…
              </p>
            )}
            {!googleClientId && googleConfigLoaded && (
              <p className="mt-4 mb-0 text-center text-ge-muted" style={{ fontSize: 12 }}>
                Acesso Google disponível quando configurado pela escola.
              </p>
            )}
          </div>

          {/* ---------- Alternar login / cadastro ---------------------------------- */}
          <div className="mt-12 pt-6 text-center" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            {mode === 'login' ? (
              <p className="mb-0 text-ge-muted" style={{ fontSize: 14 }}>
                Ainda não tem acesso?{' '}
                <button
                  type="button"
                  className="btn btn-link p-0 fw-bold text-decoration-none text-ge-primary"
                  onClick={() => { setMode('register'); resetFeedback() }}
                >
                  Cadastro de aluno
                </button>
              </p>
            ) : mode === 'register' ? (
              <p className="mb-0 text-ge-muted" style={{ fontSize: 14 }}>
                Já tem uma conta?{' '}
                <button
                  type="button"
                  className="btn btn-link p-0 fw-bold text-decoration-none text-ge-primary"
                  onClick={resetRegistration}
                >
                  Voltar para entrar
                </button>
              </p>
            ) : null}
          </div>
        </>
      )}

      {/* ---------- Aviso de segurança ---------------------------------------- */}
      <p className="mt-12 mb-0 d-flex align-items-start gap-2 text-ge-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        <LockKeyhole aria-hidden="true" className="mt-1 flex-shrink-0 text-ge-success" style={{ width: 16, height: 16 }} />
        Sua senha e o número completo do documento nunca são exibidos a outras contas.
        Responsáveis usam um acesso provisionado pela escola.
      </p>
    </AuthShell>
  )
}

// ==========================================================================
//  Shell com hero lateral (layout duplo lg+) e painel do formulário
// ==========================================================================

export interface AuthHeroCopy {
  badge: string
  title: string
  description: string
  footer: string
}

const DEFAULT_HERO: AuthHeroCopy = {
  badge: 'Seu espaço de evolução',
  title: 'Cada treino conta uma história.',
  description: 'Acompanhe seu desenvolvimento, veja os registros de treinos e converse com seu professor.',
  footer: 'Uma experiência segura para alunos e famílias. Oferecimento EwSystems',
}

export function AuthShell({ children, hero = DEFAULT_HERO }: { children: ReactNode; hero?: AuthHeroCopy }) {
  return (
    <main className="auth-shell">
      <div className="auth-wrapper row g-0 m-0">
        <section className="auth-hero col-lg-5">
          <div className="hero-backdrop">
            <img src={heroImage} alt="Ambiente esportivo escolar" aria-hidden="true" />
          </div>
          <div className="hero-content">
            <div className="d-flex align-items-center gap-4">
              <span
                className="d-flex align-items-center justify-content-center rounded-4 fw-extrabold"
                style={{
                  width: 44, height: 44, fontSize: 13, color: '#D9EFAB',
                  border: '1px solid rgba(255,255,255,0.15)',
                  backgroundColor: 'rgba(255,255,255,0.10)',
                }}
              >
                GE
              </span>
              <div>
                <span className="d-block fw-extrabold tracking-wide text-white" style={{ fontSize: 13 }}>
                  GESTÃO ESPORTIVA
                </span>
                <span className="d-block text-white-50 text-uppercase" style={{ fontSize: 10, letterSpacing: '0.2em' }}>
                  treinos e atividades de esportes
                </span>
              </div>
            </div>
          </div>
          <div className="hero-content">
            <span className="badge-ge badge-ge-hero d-inline-flex align-items-center gap-2">
              <Sparkles aria-hidden="true" style={{ width: 12, height: 12 }} />
              {hero.badge}
            </span>
            <h2 className="type-title mt-6 mb-0 text-white" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.15, maxWidth: 420 }}>
              {hero.title}
            </h2>
            <p className="mt-6 mb-0 text-white" style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(255,255,255,0.72)', maxWidth: 360 }}>
              {hero.description}
            </p>
          </div>
          <div className="hero-footer">
            {hero.footer}
          </div>
        </section>
        <section className="auth-main col-12 col-lg-7">
          <div className="auth-inner">{children}</div>
        </section>
      </div>
    </main>
  )
}
