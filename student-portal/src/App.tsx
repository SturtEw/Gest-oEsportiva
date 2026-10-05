import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Toaster, toast } from 'sonner'
import { isTeacherInvitePath, teacherInviteTokenFromLocation } from '@/lib/teacher-invite'
import {
  AccountUnavailable, AdminWorkspace, LoginScreen, PendingApproval, ResetPasswordScreen,
  StudentArea, TeacherArea, TeacherInviteScreen, prefetchAreaFor,
} from '@/lib/lazy-screens'
import { useSession } from '@/hooks/useSession'
import { ImpersonationProvider, useImpersonation } from '@/hooks/useImpersonation'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { SessionLoading } from '@/screens/SessionLoading'
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
  // `/convite-professor?token=` also carries a token; it is not a password reset.
  const [onTeacherInvite, setOnTeacherInvite] = useState(() => isTeacherInvitePath())
  const isResetRoute = useMemo(() => {
    if (typeof window === 'undefined' || onTeacherInvite) return false
    return window.location.pathname.includes('reset-senha') || resetToken !== null
  }, [resetToken, onTeacherInvite])

  // Start the area chunk as soon as the role is known, before React renders it.
  useEffect(() => {
    if (user) prefetchAreaFor(effectiveRole, { isRootAdmin: effectiveIsRootAdmin, status: user.status })
  }, [user, effectiveRole, effectiveIsRootAdmin])

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

  const logout = () => void session.logout()

  const renderScreen = (): ReactNode => {
    if (isResetRoute && !user) return <ResetPasswordScreen initialToken={resetToken} />

    if (onTeacherInvite && session.status !== 'loading') {
      return (
        <TeacherInviteScreen
          token={teacherInviteTokenFromLocation()}
          signedInAs={user}
          onRegistered={(newUser) => { setOnTeacherInvite(false); session.acceptRegistration(newUser) }}
          onLogout={logout}
          onLeave={() => setOnTeacherInvite(false)}
        />
      )
    }

    if (session.status === 'loading') return <SessionLoading />

    if (!user) {
      return (
        <LoginScreen
          error={session.error}
          onLogin={session.login}
          onGoogleLogin={session.loginGoogle}
          onRegistrationActive={session.acceptRegistration}
          onClearError={() => session.setError(null)}
        />
      )
    }

    // Protected areas use the selected view; the real session remains unchanged.
    const role = effectiveRole
    const viewUser = isImpersonating && target ? { ...user, tipo: role, nome: target.nome, aluno_id: target.aluno_id ?? null, is_root_admin: false } : user
    const readOnlyNotice = isImpersonating && <p className="border-b bg-amber-50 px-6 py-2 text-sm">Modo de consulta: alterações estão desativadas.</p>

    // Admin Root (real or impersonated as admin)
    if (role === 'admin' && effectiveIsRootAdmin) {
      return <><ImpersonationBanner /><AdminWorkspace adminName={user.nome} sessionUser={user} onLogout={logout} /></>
    }

    if (role === 'professor' && user.status === 'pendente') {
      return (
        <>
          <ImpersonationBanner />
          <PendingApproval userName={user.nome} email={user.email} refreshSession={session.refreshSession} onLogout={logout} />
        </>
      )
    }

    if (role === 'professor' && user.status === 'ativo') {
      return (
        <>
          <ImpersonationBanner />
          {readOnlyNotice}
          <TeacherArea key={target?.id ?? user.id} name={viewUser.nome} onLogout={logout} />
        </>
      )
    }

    if ((role === 'aluno' || role === 'responsavel') && user.status === 'ativo') {
      const studentId = role === 'aluno' ? viewUser.aluno_id ?? undefined : selectedChildId

      if (role === 'aluno' && !studentId) {
        return (
          <>
            <ImpersonationBanner />
            <AccountUnavailable title="Conta de aluno não vinculada" message="Fale com a escola para concluir o vínculo com seu cadastro." onLogout={logout} />
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
              onLogout={logout}
            />
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
              onLogout={logout}
            />
          </>
        )
      }

      if (role === 'responsavel' && !studentId) {
        return (
          <>
            <ImpersonationBanner />
            <main className="page-container flex min-h-screen items-center justify-center">
              <div className="portal-card max-w-md p-12 text-center">
                <p className="font-semibold">Escolha um aluno vinculado para continuar.</p>
              </div>
            </main>
          </>
        )
      }

      return (
        <>
          <ImpersonationBanner />
          {readOnlyNotice}
          <StudentArea
            key={`${user.id}:${target?.id ?? 'self'}`}
            user={viewUser}
            studentId={studentId!}
            children={children}
            selectedChildId={selectedChildId}
            onChildChange={setSelectedChildId}
            onLogout={logout}
            canEditRanking={role === 'aluno'}
          />
        </>
      )
    }

    if (user.status === 'reprovado') {
      return (
        <>
          <ImpersonationBanner />
          <AccountUnavailable title="Cadastro não aprovado" message="Entre em contato com a escola para saber como prosseguir." onLogout={logout} />
        </>
      )
    }

    return (
      <>
        <ImpersonationBanner />
        <AccountUnavailable
          title="Esta conta não tem acesso a esta área"
          message="Use a aba correspondente ao seu perfil ou fale com a escola."
          onLogout={logout}
        />
      </>
    )
  }

  return (
    <>
      {/* Every screen is a lazy chunk: while one downloads, the session loader stays up. */}
      <Suspense fallback={<SessionLoading label="Carregando…" />}>{renderScreen()}</Suspense>
      {/* Single Toaster instance for the entire app (sonner uses a portal). */}
      <Toaster position="bottom-right" richColors closeButton />
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
