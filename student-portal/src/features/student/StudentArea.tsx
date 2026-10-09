import { Suspense, useCallback, useRef, useState } from 'react'
import { Activity, Award, Bell, BookOpen, BookOpenCheck, CalendarCheck2, Dumbbell, Flag, Home, LogOut, Menu, MessageCircle, MessagesSquare, RefreshCw, School, Settings, Timer, Users, X, Trophy } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AppDownloadBanner } from '@/components/AppDownloadBanner'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/theme/ThemeProvider'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { HomeDashboard } from '@/features/home/HomeDashboard'
import {
  AchievementSection, AnnouncementsSection, AssessmentSection, AttendanceSection, ClassSummary, EnrollmentHome,
  QuestionThread, RecordsSection, StudentActivitiesSection, StudentCheckIn, StudentWorkoutsSection, TreinamentosSection, prefetchStudentSection,
} from './sections'
import { useQuestionThread } from '@/hooks/useQuestionThread'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useImpersonation } from '@/hooks/useImpersonation'
import { useStudentPortal } from '@/hooks/useStudentPortal'
import { ForumWidget } from '@/features/forum/widget/ForumWidget'
import { AccountManagement } from '@/features/account/AccountManagement'
import { MyClassesSection } from '@/features/enrollment/MyClassesSection'
import { initials } from '@/lib/formatters'
import type { LinkedChild, PortalSection, SessionUser } from '@/lib/types'

const sections: { id: PortalSection; label: string; short: string; icon: typeof Home }[] = [
  { id: 'inicio', label: 'Início', short: 'Início', icon: Home },
  { id: 'turma', label: 'Minha turma', short: 'Turma', icon: Users },
  { id: 'minhas-turmas', label: 'Minhas turmas', short: 'Turmas', icon: School },
  { id: 'presencas', label: 'Presenças', short: 'Presenças', icon: CalendarCheck2 },
  { id: 'avaliacoes', label: 'Avaliações', short: 'Avaliações', icon: BookOpenCheck },
  { id: 'conquistas', label: 'Conquistas e pontos', short: 'Conquistas', icon: Award },
  { id: 'atividades', label: 'Atividades da turma', short: 'Atividades', icon: Flag },
  { id: 'aulas', label: 'Aulas e presença', short: 'Aulas', icon: Timer },
  { id: 'meu-treino', label: 'Meu treino individual', short: 'Meu treino', icon: Dumbbell },
  { id: 'treinamentos', label: 'Treinamentos e chaves', short: 'Chaves', icon: Trophy },
  { id: 'registros', label: 'Ocorrências e justificativas', short: 'Registros', icon: BookOpen },
  { id: 'comunicados', label: 'Comunicados', short: 'Comunicados', icon: Bell },
  { id: 'duvidas', label: 'Dúvidas com o professor', short: 'Dúvidas', icon: MessageCircle },
  { id: 'forum', label: 'Fórum da turma', short: 'Fórum', icon: MessagesSquare },
  { id: 'conta', label: 'Minha conta', short: 'Conta', icon: Settings },
]

/** Placeholder while a section's chunk downloads (first visit only). */
function SectionSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando seção">
      <Skeleton className="h-24 rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
    </div>
  )
}

interface Props {
  user: SessionUser
  studentId: string
  children: LinkedChild[]
  selectedChildId?: string
  onChildChange: (id: string) => void
  onLogout: () => void
  canEditRanking: boolean
}

export function StudentArea({ user, studentId, children, selectedChildId, onChildChange, onLogout, canEditRanking }: Props) {
  const [activeSection, setActiveSection] = useState<PortalSection>('inicio')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [forcedPrivate, setForcedPrivate] = useState(false)
  const [enrollmentRevision, setEnrollmentRevision] = useState(0)
  const [activitiesRevision, setActivitiesRevision] = useState(0)
  const [subgroupsRevision, setSubgroupsRevision] = useState(0)
  const [workoutsRevision, setWorkoutsRevision] = useState(0)
  const [forumRevision, setForumRevision] = useState(0)
  const [notificationsRevision, setNotificationsRevision] = useState(0)
  const { isImpersonating } = useImpersonation()
  const portal = useStudentPortal(studentId)
  const questions = useQuestionThread(studentId)

  // Use refs to stabilize callbacks for useRealtimeSync (prevents WebSocket reconnection)
  const portalRefreshRef = useRef(portal.refresh)
  portalRefreshRef.current = portal.refresh
  const questionsRefreshRef = useRef(questions.refresh)
  questionsRefreshRef.current = questions.refresh

  const refresh = useCallback(() => { portalRefreshRef.current(); questionsRefreshRef.current() }, [])
  const onInvalidate = useCallback((event: { section: string }) => {
    // Seção "*" = polling de fallback (single_worker): refresca tudo.
    if (event.section === '*') {
      portalRefreshRef.current(); questionsRefreshRef.current()
      setEnrollmentRevision((value) => value + 1)
      setActivitiesRevision((value) => value + 1)
      setSubgroupsRevision((value) => value + 1)
      setWorkoutsRevision((value) => value + 1)
      setForumRevision((value) => value + 1)
      setNotificationsRevision((value) => value + 1)
      return
    }
    // Each invalidation touches only the section it belongs to. The blanket
    // portalRefreshRef.current() call that used to run for every event made
    // the whole student area flash (full skeleton) on every action — award
    // points, ranking toggle, message sent, etc. The portal hook already
    // keeps stale data (stale-while-revalidate), but remounting the section
    // tree on every refresh was the visible flicker users reported.
    if (event.section === 'questions') questionsRefreshRef.current()
    // A teacher's decision on a join request reaches the student as "enrollment".
    if (event.section === 'enrollment') setEnrollmentRevision((value) => value + 1)
    if (event.section === 'activities') setActivitiesRevision((value) => value + 1)
    if (event.section === 'subgroups') setSubgroupsRevision((value) => value + 1)
    if (event.section === 'individual_workouts') setWorkoutsRevision((value) => value + 1)
    // Fórum: novas mensagens chegam sem recarregar (o ChatRoom busca o delta).
    if (event.section === 'forum') setForumRevision((value) => value + 1)
    // Sino de notificações: nova notificação in-app.
    if (event.section === 'notifications') setNotificationsRevision((value) => value + 1)
    // Portal data changes (award given, ranking toggle...) refresh silently:
    // the hook keeps the current snapshot on screen while fetching.
    if (event.section === 'portal') portalRefreshRef.current()
  }, [])
  const connection = useRealtimeSync({ audience: 'student', alunoId: studentId, enabled: !isImpersonating, onInvalidate })

  // Fórum flutuante: FAB presente em todas as telas do aluno (não é uma seção).
  const forumWidget = !isImpersonating ? (
    <ForumWidget myUserId={user.id} myRole="aluno" live={connection.status === 'live'} revision={forumRevision} />
  ) : null
  const goTo = useCallback((section: PortalSection) => { setActiveSection(section); setMobileMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }, [])
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0]
  const snapshot = portal.snapshot

  const setStudentRankingPreference = useCallback(async (value: boolean) => {
    await portal.setRankingPreference(value)
  }, [portal.setRankingPreference])

  // A student account without a class lands on "find your class" (invite code or
  // join request) instead of an empty dashboard. Guardians keep the regular view.
  const needsClass = user.tipo === 'aluno' && Boolean(snapshot) && !snapshot?.turma
  // Menu hover/focus/press starts the section's chunk so the switch stays instant.
  const prefetchSection = (section: PortalSection) =>
    prefetchStudentSection(needsClass && (section === 'inicio' || section === 'turma') ? 'enrollment' : section)

  const renderSection = () => {
    if (!snapshot) return null
    if (needsClass && (activeSection === 'inicio' || activeSection === 'turma')) {
      return <EnrollmentHome revision={enrollmentRevision} onJoined={refresh} readOnly={isImpersonating} />
    }
    switch (activeSection) {
      case 'inicio': return <HomeDashboard snapshot={snapshot} onOpenSection={goTo} />
      case 'turma': return <ClassSummary turma={snapshot.turma} professorNome={snapshot.professor_nome} alunoId={studentId} />
      case 'minhas-turmas': return <MyClassesSection alunoId={studentId} revision={enrollmentRevision} readOnly={isImpersonating} onChanged={refresh} />
      case 'presencas': return <AttendanceSection attendance={snapshot.presencas} />
      case 'avaliacoes': return <AssessmentSection assessments={snapshot.avaliacoes} />
      case 'conquistas': return <AchievementSection alunoId={studentId} studentName={snapshot.aluno.nome} awards={snapshot.conquistas} participates={snapshot.aluno.participa_ranking} canEditPreference={canEditRanking && !isImpersonating} forcedPrivate={forcedPrivate} setForcedPrivate={setForcedPrivate} onPreferenceChange={setStudentRankingPreference} />
      case 'atividades': return <StudentActivitiesSection alunoId={studentId} revision={activitiesRevision} live={connection.status === 'live'} canJoin={user.tipo === 'aluno' && !isImpersonating} />
      case 'aulas': return <StudentCheckIn alunoId={studentId} revision={subgroupsRevision} live={connection.status === 'live'} canCheckIn={user.tipo === 'aluno' && !isImpersonating} />
      case 'meu-treino': return <StudentWorkoutsSection alunoId={studentId} revision={workoutsRevision} canExecute={user.tipo === 'aluno' && !isImpersonating} onNotice={() => undefined} />
      case 'treinamentos': return <TreinamentosSection />
      case 'registros': return <RecordsSection incidents={snapshot.ocorrencias} justifications={snapshot.justificativas} />
      case 'comunicados': return <AnnouncementsSection announcements={snapshot.comunicados} />
      case 'duvidas': return isImpersonating ? <p className="rounded-xl bg-amber-50 p-4 text-sm">As dúvidas estão disponíveis apenas para consulta nesta visualização.</p> : <QuestionThread alunoId={studentId} turma={snapshot.turma} professorNome={snapshot.professor_nome} sessionUser={user} messages={questions.messages} loading={questions.loading} error={questions.error} onSend={questions.send} onRetry={questions.retry} onRefresh={questions.refresh} />
      case 'forum': return isImpersonating ? <p className="rounded-xl bg-amber-50 p-4 text-sm">O fórum está disponível apenas para consulta nesta visualização.</p> : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">O fórum agora fica no botão de chat flutuante, no canto da tela. Ele está disponível em todas as telas do portal.</p>
      case 'conta': return <AccountManagement sessionUser={{ nome: user.nome, email: user.email, tipo: user.tipo, tem_senha: user.tem_senha }} onAccountChanged={refresh} onSignedOut={onLogout} />
    }
  }

  return <div className="min-h-screen bg-background text-foreground">
    <AppDownloadBanner />
    {forumWidget}
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 flex-col bg-sidebar px-4 py-6 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-2"><span className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 font-display text-sm font-extrabold text-[#D9EFAB]">GE</span><span><span className="block font-display text-[13px] font-extrabold tracking-wide">GESTÃO ESPORTIVA</span><span className="mt-1 block text-[10px] uppercase tracking-[0.2em] text-white/55">escolar</span></span></div>
        <p className="mb-3 mt-10 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{user.tipo === 'responsavel' ? 'Área da família' : 'Área do aluno'}</p>
        <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 overflow-y-auto">{sections.map((section) => { const Icon = section.icon; return <Button key={section.id} variant="ghost" onClick={() => goTo(section.id)} onPointerEnter={() => prefetchSection(section.id)} onFocus={() => prefetchSection(section.id)} aria-current={activeSection === section.id ? 'page' : undefined} className={`min-h-11 w-full justify-start gap-3 rounded-xl px-3 text-left text-[13px] ${activeSection === section.id ? 'bg-[#D9EFAB] font-bold text-[#183C32] hover:bg-[#D9EFAB]' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}><Icon aria-hidden="true" className="size-[18px] shrink-0" />{section.label}</Button> })}</nav>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-3"><div className="flex items-center gap-3"><Avatar className="size-9 bg-[#E8CDA5] text-[#4B3526]"><AvatarFallback className="bg-[#E8CDA5] text-xs font-bold text-[#4B3526]">{initials(user.nome)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{user.nome}</p><p className="mt-0.5 text-[11px] text-white/55">{user.tipo === 'responsavel' ? 'Responsável' : 'Aluno'}</p></div><Button variant="ghost" size="icon-sm" aria-label="Sair da conta" onClick={onLogout} className="text-white/70 hover:text-white"><LogOut aria-hidden="true" /></Button></div></div>
      </aside>

      <main id="main-content" className="min-w-0 flex-1 pb-24 lg:pb-8">
        <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-sm"><div className="page-container flex min-h-[68px] items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" aria-label="Abrir navegação" className="lg:hidden" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</Button><div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-[0.15em] text-[#66806D]">{currentSection.label}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{user.tipo === 'responsavel' ? `Acompanhando ${snapshot?.aluno.nome ?? 'aluno'}` : 'Seu espaço de aprendizado e esporte'}</p></div></div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3"><ThemeToggle /><ConnectionStatus status={connection.status} message={connection.message} lastUpdatedAt={connection.lastUpdatedAt} /><NotificationBell revision={notificationsRevision} />{user.tipo === 'responsavel' && children.length > 0 && <Select items={children.map((child) => ({ value: child.id, label: child.nome }))} value={selectedChildId} onValueChange={(value) => { if (typeof value === 'string') onChildChange(value) }}><SelectTrigger className="h-10 max-w-[180px] rounded-xl border-[#D8E1D5] bg-white text-xs sm:max-w-[240px] sm:text-sm" aria-label="Escolher aluno vinculado"><SelectValue placeholder="Escolha o aluno" /></SelectTrigger><SelectContent>{children.map((child) => <SelectItem key={child.id} value={child.id}>{child.nome}</SelectItem>)}</SelectContent></Select>}<Button variant="ghost" size="icon" aria-label="Atualizar meus dados" className="hidden sm:inline-flex" onClick={refresh}><RefreshCw aria-hidden="true" /></Button><Button variant="ghost" size="icon" aria-label="Sair da conta" className="lg:hidden" onClick={onLogout}><LogOut aria-hidden="true" /></Button></div>
        </div></header>
        {mobileMenuOpen && <nav aria-label="Navegação principal" className="absolute left-0 right-0 top-[68px] z-30 border-b border-border bg-white p-3 shadow-xl lg:hidden"><div className="grid grid-cols-2 gap-1 sm:grid-cols-4">{sections.map((section) => { const Icon = section.icon; return <Button key={section.id} variant={activeSection === section.id ? 'secondary' : 'ghost'} onClick={() => goTo(section.id)} onPointerDown={() => prefetchSection(section.id)} onFocus={() => prefetchSection(section.id)} className="min-h-12 justify-start gap-2 rounded-xl px-3 text-left text-xs"><Icon aria-hidden="true" className="size-4 shrink-0" />{section.label}</Button> })}</div></nav>}
        <div className="page-container py-6 sm:py-8">{user.tipo === 'responsavel' && children.length > 1 && <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#DDE8D4] bg-[#F6FAF2] px-4 py-3 text-xs leading-5 text-[#48614C]"><Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Você vê somente os registros do aluno selecionado. O responsável não pode alterar a participação no ranking.</div>}
          {connection.status === 'single_worker' && <Alert className="mb-5 border-[#E9E1CC] bg-[#FFFDF7]"><Activity aria-hidden="true" /><AlertTitle>Sincronização limitada a este servidor</AlertTitle><AlertDescription>{connection.message}</AlertDescription></Alert>}
          {connection.status === 'offline' && <Alert className="mb-5 border-[#F2D8C8] bg-[#FFF7F3]"><Activity aria-hidden="true" /><AlertTitle>Sem conexão ao vivo</AlertTitle><AlertDescription>Os dados carregados permanecem disponíveis; a conexão será restabelecida automaticamente.</AlertDescription></Alert>}
          {portal.loading ? <div className="space-y-5"><Skeleton className="h-72 rounded-[1.65rem]" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div></div> : portal.error ? <Alert variant="destructive"><AlertTitle>Não foi possível carregar seus dados.</AlertTitle><AlertDescription className="mt-2 flex items-center justify-between gap-3"><span>{portal.error}</span><Button variant="outline" size="sm" onClick={portal.refresh}>Tentar novamente</Button></AlertDescription></Alert> : <SectionErrorBoundary key={activeSection} label={currentSection.label}><Suspense fallback={<SectionSkeleton />}>{renderSection()}</Suspense></SectionErrorBoundary>}
        </div>
        <footer className="page-container hidden items-center justify-between border-t border-border/70 py-5 text-[11px] text-muted-foreground md:flex"><span>Gestão Esportiva Escolar · Seu percurso, no seu ritmo.</span><span>Dados privados do aluno selecionado.</span></footer>
      </main>
    </div>
    {!mobileMenuOpen && <nav aria-label="Navegação rápida" className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-2 shadow-[0_-6px_20px_rgba(28,55,42,0.045)] backdrop-blur-md lg:hidden"><div className="mx-auto flex max-w-xl items-stretch justify-around gap-0.5">{sections.filter((section) => ['inicio', 'presencas', 'avaliacoes', 'conquistas', 'atividades', 'duvidas'].includes(section.id)).map((section) => { const Icon = section.icon; return <Button key={section.id} variant="ghost" onClick={() => goTo(section.id)} onPointerDown={() => prefetchSection(section.id)} aria-current={activeSection === section.id ? 'page' : undefined} className={`h-auto min-h-12 min-w-0 flex-1 flex-col gap-1 rounded-lg px-1 py-1 text-[9px] ${activeSection === section.id ? 'bg-[#EAF0E5] text-[#234E40]' : 'text-muted-foreground'}`}><Icon aria-hidden="true" className="size-[18px]" /><span className="max-w-full truncate">{section.short}</span></Button> })}</div></nav>}
  </div>
}
