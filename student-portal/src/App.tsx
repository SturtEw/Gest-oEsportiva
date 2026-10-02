import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Eye, EyeOff, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { LoginScreen } from '@/components/LoginScreen'
import { AdminWorkspace } from '@/features/admin/AdminWorkspace'
import { TeacherArea } from '@/features/teacher/TeacherArea'
import { StudentArea } from '@/features/student/StudentArea'
import { useSession } from '@/hooks/useSession'
import { ImpersonationProvider, useImpersonation } from '@/hooks/useImpersonation'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { api } from '@/lib/api'
import type { LinkedChild } from '@/lib/types'

type Session = ReturnType<typeof useSession>

// Inner component that has access to impersonation context. It receives the
// session from App instead of calling useSession() again: two hook instances
// meant two independent GET /api/auth/me on every load (and two states that
// could disagree after login).
function AppContent({ session }: { session: Session }) {
  const { effectiveRole, effectiveIsRootAdmin, isImpersonating, target } = useImpersonation()
  const [children, setChildren] = useState<LinkedChild[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>()
  const [childrenError, setChildrenError] = useState<string | null>(null)
  const user = session.user

  const resetToken = useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('token')
  }, [])
  const isResetRoute = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.location.pathname.includes('reset-senha') || resetToken !== null
  }, [resetToken])

  // Single Toaster instance for the entire app (sonner uses portal)
  const toaster = <Toaster position="bottom-right" richColors closeButton />

  // Fetch linked children for responsavel - use effectiveRole
  useEffect(() => {
    if (effectiveRole !== 'responsavel') {
      setChildren([]); setSelectedChildId(undefined); setChildrenError(null); return
    }
    // Clear error when user changes (prevents stale error from previous user)
    setChildrenError(null)
    let active = true
    setChildren([])
    setSelectedChildId(undefined)
    api.children().then(({ children: linked }) => {
      if (!active) return
      setChildren(linked)
      setSelectedChildId(linked[0]?.id)
      setChildrenError(null)
    }).catch((cause: unknown) => {
      if (!active) return
      const msg = cause instanceof Error ? cause.message : 'Não foi possível carregar os alunos vinculados.'
      setChildrenError(msg)
      toast.error(msg)
    })
    return () => { active = false }
  }, [user?.id, effectiveRole])

  if (isResetRoute && !user) {
    return (
      <>
        <ResetPasswordScreen initialToken={resetToken} />
        {toaster}
      </>
    )
  }

  if (session.status === 'loading') {
    return (
      <>
        <main className="d-flex align-items-center justify-content-center bg-body min-vh-100">
          <div className="d-flex align-items-center gap-3 text-ge-muted" style={{ fontSize: 14 }}>
            <RefreshCw aria-hidden="true" className="spinner-border spinner-border-sm" style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
            Verificando sua sessão…
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </main>
        {toaster}
      </>
    )
  }

  if (!user) {
    return (
      <>
        <LoginScreen
          error={session.error}
          onLogin={session.login}
          onGoogleLogin={session.loginGoogle}
          onRegistrationActive={session.acceptRegistration}
          onClearError={() => session.setError(null)}
        />
        {toaster}
      </>
    )
  }

  // Protected areas use the selected view; the real session remains unchanged.
  const role = effectiveRole
  const isRootAdmin = effectiveIsRootAdmin
  const viewUser = isImpersonating && target ? { ...user, tipo: role, nome: target.nome, aluno_id: target.aluno_id ?? null, is_root_admin: false } : user

  // Admin Root (real or impersonated as admin)
  if (role === 'admin' && isRootAdmin) {
    return (
      <>
        <ImpersonationBanner />
        <AdminWorkspace adminName={user.nome} sessionUser={user} onLogout={() => void session.logout()} />
        {toaster}
      </>
    )
  }

  // Professor - pendente
  if (role === 'professor' && user.status === 'pendente') {
    return (
      <>
        <ImpersonationBanner />
        <PendingApproval
          userName={user.nome}
          email={user.email}
          refreshSession={session.refreshSession}
          onLogout={() => void session.logout()}
        />
        {toaster}
      </>
    )
  }

  // Professor - ativo
  if (role === 'professor' && user.status === 'ativo') {
    return (
      <>
        <ImpersonationBanner />
        {isImpersonating && <p className="border-b bg-amber-50 px-4 py-2 text-sm">Modo de consulta: alterações estão desativadas.</p>}
        <TeacherArea key={target?.id ?? user.id} name={viewUser.nome} onLogout={() => void session.logout()} />
        {toaster}
      </>
    )
  }

  // Aluno / Responsavel - ativo
  if ((role === 'aluno' || role === 'responsavel') && user.status === 'ativo') {
    const studentId = role === 'aluno' ? viewUser.aluno_id ?? undefined : selectedChildId

    if (role === 'aluno' && !studentId) {
      return (
        <>
          <ImpersonationBanner />
          <AccountUnavailable
            title="Conta de aluno não vinculada"
            message="Fale com a escola para concluir o vínculo com seu cadastro."
            onLogout={() => void session.logout()}
          />
          {toaster}
        </>
      )
    }

    if (role === 'responsavel' && childrenError) {
      return (
        <>
          <ImpersonationBanner />
          <AccountUnavailable
            title="Não foi possível carregar os alunos vinculados"
            message={childrenError}
            onRetry={() => {
              setChildrenError(null)
              void api.children()
                .then(({ children: linked }) => { setChildren(linked); setSelectedChildId(linked[0]?.id) })
                .catch((cause: unknown) => {
                  const msg = cause instanceof Error ? cause.message : 'Não foi possível carregar os alunos.'
                  setChildrenError(msg)
                  toast.error(msg)
                })
            }}
            onLogout={() => void session.logout()}
          />
          {toaster}
        </>
      )
    }

    if (role === 'responsavel' && children.length === 0 && !selectedChildId) {
      return (
        <>
          <ImpersonationBanner />
          <AccountUnavailable
            title="Nenhum aluno vinculado"
            message="Esta conta ainda não tem um aluno associado. Confira com a escola se o vínculo está atualizado."
            onLogout={() => void session.logout()}
          />
          {toaster}
        </>
      )
    }

    if (role === 'responsavel' && !studentId) {
      return (
        <>
          <ImpersonationBanner />
          <main className="page-container d-flex align-items-center justify-content-center min-vh-100">
            <div className="portal-card p-5 text-center" style={{ maxWidth: 448 }}>
              <p className="mb-0 fw-semibold">Escolha um aluno vinculado para continuar.</p>
            </div>
          </main>
          {toaster}
        </>
      )
    }

    return (
      <>
        <ImpersonationBanner />
        {isImpersonating && <p className="border-b bg-amber-50 px-4 py-2 text-sm">Modo de consulta: alterações estão desativadas.</p>}
        <StudentArea
          key={`${user.id}:${target?.id ?? 'self'}`}
          user={viewUser}
          studentId={studentId!}
          children={children}
          selectedChildId={selectedChildId}
          onChildChange={setSelectedChildId}
          onLogout={() => void session.logout()}
          canEditRanking={role === 'aluno'}
        />
        {toaster}
      </>
    )
  }

  if (user.status === 'reprovado') {
    return (
      <>
        <ImpersonationBanner />
        <AccountUnavailable
          title="Cadastro não aprovado"
          message="Entre em contato com a escola para saber como prosseguir."
          onLogout={() => void session.logout()}
        />
        {toaster}
      </>
    )
  }

  return (
    <>
      <ImpersonationBanner />
      <AccountUnavailable
        title="Esta conta não tem acesso a esta área"
        message="Use a aba correspondente ao seu perfil ou fale com a escola."
        onLogout={() => void session.logout()}
      />
      {toaster}
    </>
  )
}

// Root App component with ImpersonationProvider
export default function App() {
  const session = useSession()
  const user = session.user

  return (
    <ImpersonationProvider
      key={user?.id ?? 'anonymous'}
      userRole={user?.tipo ?? null}
      userIsRootAdmin={user?.is_root_admin ?? false}
      userId={user?.id ?? null}
    >
      <AppContent session={session} />
    </ImpersonationProvider>
  )
}

// ==========================================================================
//  ResetPasswordScreen — Tela /reset-senha?token=
// ==========================================================================
function ResetPasswordScreen({ initialToken }: { initialToken: string | null }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasToken = initialToken && initialToken.trim().length > 40

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!hasToken) { setError('Link inválido ou expirado. Solicite um novo link de recuperação.'); return }
    if (newPassword.length < 10) { setError('A senha precisa ter pelo menos 10 caracteres.'); return }
    if (newPassword !== confirmPassword) { setError('As senhas digitadas não coincidem.'); return }
    setLoading(true)
    try {
      await api.resetPassword(initialToken!, newPassword)
      setSuccess(true)
    } catch (cause) {
      setSuccess(false)
      setError(cause instanceof Error ? cause.message : 'Não foi possível redefinir sua senha.')
    } finally { setLoading(false) }
  }

  const goToLogin = () => {
    const clean = new URL(window.location.href)
    clean.searchParams.delete('token')
    clean.pathname = clean.pathname.replace(/reset-senha\/?$/i, '') || '/'
    window.location.href = clean.toString()
  }

  return (
    <main className="d-flex align-items-center justify-content-center bg-body min-vh-100 px-4 py-5 py-md-10">
      <div className="portal-card p-4 p-sm-5" style={{ maxWidth: 520, width: '100%' }}>
        <div className="d-flex justify-content-center mb-4">
          <div
            className="d-flex align-items-center justify-content-center rounded-4"
            style={{
              width: 56, height: 56,
              backgroundColor: success ? '#EAF0E5' : error || !hasToken ? '#FFF0E9' : '#F1EEF7',
              color: success ? '#668C5D' : error || !hasToken ? '#B7542B' : '#63547F',
            }}
          >
            {success ? (
              <CheckCircle2 aria-hidden="true" style={{ width: 28, height: 28 }} />
            ) : (
              <KeyRound aria-hidden="true" style={{ width: 28, height: 28 }} />
            )}
          </div>
        </div>

        <div className="text-center mb-4">
          <h1 className="type-title mb-0" style={{ fontSize: 26, fontWeight: 800, color: '#18372F' }}>
            {success ? 'Senha redefinida' : !hasToken ? 'Link inválido' : 'Criar nova senha'}
          </h1>
          <p className="mt-3 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {success
              ? 'Sua senha foi atualizada com sucesso. Use a nova senha para entrar na sua conta.'
              : !hasToken
                ? 'Este link de recuperação está incompleto ou já expirou. Solicite um novo link na tela de login.'
                : 'Digite uma nova senha segura com pelo menos 10 caracteres. Não reutilize senhas antigas.'}
          </p>
        </div>

        {error && (
          <div className="alert alert-danger d-flex align-items-start gap-2 rounded-3 mb-4" role="alert" style={{ fontSize: 14 }}>
            <span className="mt-1 d-flex"><AlertCircle aria-hidden="true" style={{ width: 18, height: 18 }} /></span>
            <div className="flex-grow-1">{error}</div>
          </div>
        )}

        {success ? (
          <button
            type="button"
            className="btn btn-ge-primary w-100 d-flex align-items-center justify-content-center gap-2 fw-bold"
            style={{ height: 48, borderRadius: 16 }}
            onClick={goToLogin}
          >
            Ir para a tela de login
            <Mail aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
        ) : hasToken ? (
          <form className="d-grid gap-3" onSubmit={(e) => void submit(e)} noValidate>
            <div className="position-relative">
              <label htmlFor="reset-new" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Nova senha</label>
              <div className="position-relative">
                <span className="input-icon-start" aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#66806D' }}>
                  <KeyRound style={{ width: 18, height: 18 }} />
                </span>
                <input
                  id="reset-new"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={72}
                  required
                  className="form-control"
                  style={{ height: 51, borderRadius: 14, paddingLeft: 44, paddingRight: 44 }}
                  placeholder=" "
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="link-secondary"
                  aria-label={showNew ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, padding: 4, color: '#66806D' }}
                >
                  {showNew ? <EyeOff aria-hidden="true" style={{ width: 18, height: 18 }} /> : <Eye aria-hidden="true" style={{ width: 18, height: 18 }} />}
                </button>
              </div>
              <div className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>Mínimo de 10 caracteres.</div>
            </div>

            <div className="position-relative">
              <label htmlFor="reset-confirm" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Confirmar nova senha</label>
              <div className="position-relative">
                <span className="input-icon-start" aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#66806D' }}>
                  <ShieldCheck style={{ width: 18, height: 18 }} />
                </span>
                <input
                  id="reset-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={72}
                  required
                  className="form-control"
                  style={{ height: 51, borderRadius: 14, paddingLeft: 44, paddingRight: 44 }}
                  placeholder=" "
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="link-secondary"
                  aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, padding: 4, color: '#66806D' }}
                >
                  {showConfirm ? <EyeOff aria-hidden="true" style={{ width: 18, height: 18 }} /> : <Eye aria-hidden="true" style={{ width: 18, height: 18 }} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1"
              style={{ height: 48, borderRadius: 16 }}
            >
              {loading ? 'Redefinindo…' : 'Redefinir senha'}
            </button>
          </form>
        ) : null}

        <button
          type="button"
          className="btn btn-outline-secondary mt-3 w-100 d-flex align-items-center justify-content-center gap-2 border-0 text-ge-muted"
          style={{ borderRadius: 16 }}
          onClick={goToLogin}
        >
          <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
          Voltar para entrar
        </button>
      </div>
    </main>
  )
}

// ==========================================================================
//  PendingApproval — Bootstrap
// ==========================================================================
function PendingApproval({
  userName, email, refreshSession, onLogout,
}: {
  userName: string
  email: string
  refreshSession: () => Promise<void>
  onLogout: () => void
}) {
  useEffect(() => {
    const interval = window.setInterval(() => void refreshSession(), 20000)
    return () => window.clearInterval(interval)
  }, [refreshSession])

  return (
    <main className="bg-body min-vh-100 px-4 py-5 py-md-10">
      <header className="page-container d-flex align-items-center justify-content-between mb-5">
        <div className="d-flex align-items-center gap-3">
          <span
            className="d-flex align-items-center justify-content-center rounded-4 fw-extrabold"
            style={{
              width: 40, height: 40, fontSize: 13, color: '#D9EFAB',
              backgroundColor: '#153B34',
            }}
          >
            GE
          </span>
          <div>
            <p className="mb-0 fw-extrabold text-ge-primary" style={{ fontSize: 12 }}>
              GESTÃO ESPORTIVA ESCOLAR
            </p>
            <p className="mb-0 mt-1 text-ge-muted" style={{ fontSize: 11 }}>
              Área do professor
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ge-outline d-flex align-items-center gap-2 fw-medium"
          style={{ borderRadius: 14 }}
          onClick={onLogout}
        >
          Sair
          <LogOut aria-hidden="true" style={{ width: 16, height: 16 }} />
        </button>
      </header>

      <div className="mx-auto" style={{ maxWidth: 640 }}>
        <div className="portal-card p-4 p-sm-5">
          <div className="d-flex justify-content-center mb-4">
            <div
              className="d-flex align-items-center justify-content-center rounded-4"
              style={{ width: 56, height: 56, backgroundColor: '#FFF5DB', color: '#896622' }}
            >
              <Clock3 aria-hidden="true" style={{ width: 28, height: 28 }} />
            </div>
          </div>

          <div className="text-center">
            <span className="badge-ge badge-ge-notice mb-0">Cadastro em análise</span>
            <h1 className="type-title mt-4 mb-0" style={{ fontSize: 30, fontWeight: 800 }}>
              Aguardando aprovação
            </h1>
            <p className="mt-3 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Olá, {userName}. Sua conta de professor será ativada após a análise do administrador.
            </p>
            <p className="mt-4 mb-0 rounded-3 bg-ge-light p-3 fw-medium text-center">
              {email}
            </p>
          </div>

          <div className="alert alert-warning mt-5 d-flex align-items-start gap-3 rounded-3 border-0" role="alert"
               style={{ backgroundColor: '#FFFDF7', color: '#896622' }}>
            <ShieldCheck aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }} />
            <div className="flex-grow-1">
              <h2 className="alert-heading mb-1 fw-bold" style={{ fontSize: 15 }}>
                Acesso restrito até a decisão
              </h2>
              <p className="mb-0" style={{ fontSize: 14, lineHeight: 1.6 }}>
                As ferramentas do professor ficam indisponíveis enquanto o cadastro estiver pendente.
                Esta tela verifica o status automaticamente.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ge-outline w-100 d-flex align-items-center justify-content-center gap-2 mt-5 fw-medium"
            style={{ borderRadius: 16 }}
            onClick={() => void refreshSession()}
          >
            <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
            Verificar novamente
          </button>
        </div>
      </div>
    </main>
  )
}

// ==========================================================================
//  AccountUnavailable — Bootstrap
// ==========================================================================
function AccountUnavailable({
  title, message, onLogout, onRetry,
}: {
  title: string
  message: string
  onLogout: () => void
  onRetry?: () => void
}) {
  return (
    <main className="d-flex align-items-center justify-content-center bg-body min-vh-100 px-4 py-5 py-md-10">
      <div className="portal-card text-center p-5 p-md-7" style={{ maxWidth: 520 }}>
        <div className="d-flex justify-content-center mb-4">
          <div
            className="d-flex align-items-center justify-content-center rounded-4"
            style={{ width: 56, height: 56, backgroundColor: '#FFF5DB', color: '#896622' }}
          >
            <AlertCircle aria-hidden="true" style={{ width: 24, height: 24 }} />
          </div>
        </div>
        <h1 className="type-title mb-0" style={{ fontSize: 24, fontWeight: 800 }}>
          {title}
        </h1>
        <p className="mt-3 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </p>
        <div className="mt-5 d-flex flex-column flex-sm-row justify-content-center gap-2">
          {onRetry && (
            <button
              type="button"
              className="btn btn-ge-outline d-flex align-items-center justify-content-center gap-2 fw-medium"
              style={{ borderRadius: 16 }}
              onClick={onRetry}
            >
              Tentar novamente
              <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold"
            style={{ borderRadius: 16 }}
            onClick={onLogout}
          >
            Sair da conta
            <LogOut aria-hidden="true" style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </main>
  )
}



