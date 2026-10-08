import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowRight, BookOpen, Check, CircleAlert, Eye, GraduationCap, KeyRound, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { api } from '@/lib/api'
import { KpiCard } from '@/features/teacher/dashboard/KpiCard'
import { firstName, formatDate, initials } from '@/lib/formatters'
import { GoogleAuthError, mountGoogleSignInButton } from '@/lib/google-identity'
import type { AdminClass, AdminTeacher, SessionUser, StudentPortalSnapshot, TeacherApplication, UnassignedStudent } from '@/lib/types'
import { RoleSelector } from '@/components/RoleSelector'
import { TeacherInvitesPanel } from './TeacherInvitesPanel'

type AdminTab = 'teachers' | 'students' | 'classes' | 'teacher-tools' | 'student-inspection' | 'account'
interface Summary { professores_pendentes: number; notificacoes_pendentes: number; alunos_sem_turma: number; turmas: number }
interface TeacherWorkspaceClass { id: string; nome: string; modalidade: string; ano: number; professor_nome: string; alunos: Array<{id: string; nome: string}> }

// The account card reads the session the App already resolved. Fetching
// /api/auth/me again here repeated the call on every load and every realtime refresh.
export function AdminWorkspace({ adminName, sessionUser, onLogout }: { adminName: string; sessionUser: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<AdminTab>('teachers')
  const [summary, setSummary] = useState<Summary>({ professores_pendentes: 0, notificacoes_pendentes: 0, alunos_sem_turma: 0, turmas: 0 })
  const [applications, setApplications] = useState<TeacherApplication[]>([])
  const [students, setStudents] = useState<UnassignedStudent[]>([])
  const [classes, setClasses] = useState<AdminClass[]>([])
  const [teachers, setTeachers] = useState<AdminTeacher[]>([])
  const [teacherWorkspace, setTeacherWorkspace] = useState<TeacherWorkspaceClass[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedApplication, setSelectedApplication] = useState<TeacherApplication | null>(null)
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<UnassignedStudent | null>(null)
  const [selectedClassId, setSelectedClassId] = useState<string | undefined>()
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [createClassOpen, setCreateClassOpen] = useState(false)
  const [className, setClassName] = useState('')
  const [sport, setSport] = useState('')
  const [newClassTeacher, setNewClassTeacher] = useState<string | undefined>()
  const [year, setYear] = useState(new Date().getFullYear())
  const [capacity, setCapacity] = useState(20)
  const [classBusy, setClassBusy] = useState(false)
  const [deleteClassTarget, setDeleteClassTarget] = useState<AdminClass | null>(null)
  const [deleteClassBusy, setDeleteClassBusy] = useState(false)
  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [inspection, setInspection] = useState<StudentPortalSnapshot | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const adminEmail = sessionUser.email ?? ''
  const adminHasPassword = Boolean(sessionUser.tem_senha ?? true)
  const [googleLinked, setGoogleLinked] = useState(Boolean(sessionUser.google_sub))
  const [googleEmail, setGoogleEmail] = useState<string>(sessionUser.google_email ?? '')
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const [googleConfigLoaded, setGoogleConfigLoaded] = useState(false)
  const [googleLinkBusy, setGoogleLinkBusy] = useState(false)
  const googleLinkButtonRef = useRef<HTMLDivElement | null>(null)
  const [googleUnlinkBusy, setGoogleUnlinkBusy] = useState(false)

  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const onInvalidate = useCallback(() => refresh(), [refresh])
  const connection = useRealtimeSync({ audience: 'admin', enabled: true, onInvalidate })

  // "Já houve um primeiro load?": ler classes/students do closure do efeito
  // devolve valor stale após o primeiro render (deps [revision, search]).
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    let active = true
    // Only the very first load shows skeletons and surfaces fetch errors; later
    // revisions (after creating a class, assigning a teacher, realtime pings)
    // revalidate in place. A background hiccup used to paint the whole screen
    // with "Verifique sua conexão" and flash skeletons right after a successful
    // action — the class was created, the UI just threw the refetch failure at it.
    setLoading(!hasLoadedRef.current)
    Promise.all([
      api.adminSummary(),
      api.teacherApplications(),
      api.adminStudents(search, true),
      api.classes(),
      api.approvedTeachers(),
      api.adminTeacherWorkspace(),
      api.googleConfig(),
    ])
      .then(([nextSummary, nextApplications, nextStudents, nextClasses, nextTeachers, nextWorkspace, googleConfig]) => {
        if (!active) return
        setSummary(nextSummary)
        setApplications(nextApplications.applications)
        setStudents(nextStudents.students)
        setClasses(nextClasses.classes)
        setTeachers(nextTeachers.teachers)
        setTeacherWorkspace(nextWorkspace.classes)
        if (googleConfig?.client_id) setGoogleClientId(googleConfig.client_id)
        hasLoadedRef.current = true
      })
      .catch((cause: unknown) => {
        if (!active) return
        // Fail loudly only when there is nothing on screen yet; a refetch failure
        // after a successful mutation must not erase the success notice.
        if (!hasLoadedRef.current) {
          setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados administrativos.')
        }
      })
      .finally(() => { if (active) { setLoading(false); setGoogleConfigLoaded(true) } })
    return () => { active = false }
  }, [revision, search])

  const handleGoogleLink = async () => {
    if (!googleClientId) { setError('Google ainda não configurado pela escola.'); return }
    setGoogleLinkBusy(true)
    setError(null)
    try {
      // Same helper as the login screen: Google's own button opens a real account
      // chooser popup, which works wherever One Tap silently refuses to draw.
      const mountPoint = googleLinkButtonRef.current
      if (!mountPoint) throw new GoogleAuthError('Não foi possível preparar o botão do Google.', false)

      const credential = new Promise<string>((resolve, reject) => {
        void mountGoogleSignInButton({
          clientId: googleClientId,
          container: mountPoint,
          text: 'signin_with',
          onCredential: (token) => resolve(token),
          onError: (cause: unknown) => reject(cause instanceof Error ? cause : new GoogleAuthError('Falha ao obter a conta Google.')),
        }).catch((cause: unknown) => reject(cause instanceof Error ? cause : new GoogleAuthError('Falha ao carregar o Google.')))
      })

      const result = await api.googleLink(await credential)
      setGoogleLinked(true)
      setGoogleEmail(result.google_email || '')
      setNotice(`Conta Google vinculada: ${result.google_email || 'confirmada'}`)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível vincular a conta Google.')
    } finally { setGoogleLinkBusy(false) }
  }

  const handleGoogleUnlink = async () => {
    if (!adminHasPassword) {
      setError('Você precisa ter uma senha definida antes de desvincular a conta Google.')
      return
    }
    if (!window.confirm('Confirma desvincular sua conta Google? Você continuará conseguindo entrar com e-mail e senha.')) return
    setGoogleUnlinkBusy(true)
    setError(null)
    try {
      await api.googleUnlink()
      setGoogleLinked(false)
      setGoogleEmail('')
      setNotice('Conta Google desvinculada.')
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível desvincular a conta Google.')
    } finally { setGoogleUnlinkBusy(false) }
  }

  useEffect(() => {
    if (!inspectionId) { setInspection(null); return }
    let active = true
    setInspectionLoading(true)
    api.inspectStudent(inspectionId)
      .then((result) => { if (active) setInspection(result.student_portal) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível inspecionar esta conta.') })
      .finally(() => { if (active) setInspectionLoading(false) })
    return () => { active = false }
  }, [inspectionId, revision])

  const visibleApplications = useMemo(() => applications, [applications])
  // Base UI Select shows the raw value (a UUID) in the trigger unless it knows the labels.
  const teacherItems = useMemo(
    () => [{ value: 'none', label: 'Sem professor vinculado' }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.nome }))],
    [teachers],
  )

  const handleDecision = async () => {
    if (!selectedApplication || !decision) return
    if (decision === 'reject' && rejectReason.trim().length < 5) return
    setDecisionBusy(true)
    try {
      await api.decideTeacher(selectedApplication.id, decision === 'approve', decision === 'reject' ? rejectReason.trim() : undefined)
      setNotice(decision === 'approve' ? `Cadastro de ${selectedApplication.nome} aprovado.` : `Cadastro de ${selectedApplication.nome} reprovado.`)
      setDecision(null)
      setSelectedApplication(null)
      setRejectReason('')
      refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão.') }
    finally { setDecisionBusy(false) }
  }

  const handleAssignment = async () => {
    if (!selectedStudent || !selectedClassId) return
    setAssignmentBusy(true)
    try {
      const result = await api.assignClass(selectedStudent.id, selectedClassId) as { turma_nome: string }
      setNotice(`${selectedStudent.nome} foi vinculado(a) à turma ${result.turma_nome}.`)
      setSelectedStudent(null)
      setSelectedClassId(undefined)
      refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível vincular o aluno.') }
    finally { setAssignmentBusy(false) }
  }

  const handleCreateClass = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setClassBusy(true)
    try {
      await api.createClass({ nome: className.trim(), modalidade: sport.trim(), ano: year, capacidade: capacity, professor_id: newClassTeacher })
      setNotice(`Turma ${className.trim()} criada.`)
      setClassName('')
      setSport('')
      setCreateClassOpen(false)
      refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a turma.') }
    finally { setClassBusy(false) }
  }

  const handleDeleteClass = async () => {
    if (!deleteClassTarget) return
    setDeleteClassBusy(true)
    try {
      const result = await api.deleteClass(deleteClassTarget.id)
      setNotice(`Turma ${result.nome} excluída.${result.students_unlinked > 0 ? ` ${result.students_unlinked} aluno(s) ficaram sem turma.` : ''}`)
      setDeleteClassTarget(null)
      refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir a turma.') }
    finally { setDeleteClassBusy(false) }
  }

  return <AppShell
    nav={[
      { id: 'teachers', label: 'Professores', icon: GraduationCap, badge: summary.professores_pendentes || undefined },
      // Coral (default) = needs action; a plain count of classes is informational.
      { id: 'students', label: 'Alunos', icon: Users, badge: summary.alunos_sem_turma || undefined, badgeVariant: 'amber' },
      { id: 'classes', label: 'Turmas', icon: BookOpen, badge: summary.turmas || undefined, badgeVariant: 'emerald' },
      { id: 'teacher-tools', label: 'Professor', icon: Activity },
      { id: 'student-inspection', label: 'Aluno', icon: Eye },
      { id: 'account', label: 'Conta', icon: KeyRound },
    ]}
    active={tab}
    onNavigate={(id) => setTab(id as AdminTab)}
    roleLabel="Administração raiz"
    userName={adminName}
    subtitle="Administração raiz · contas, turmas e matrículas"
    monogram={initials(adminName)}
    onLogout={onLogout}
    connection={connection}
    headerEnd={<RoleSelector />}
  >
    <>
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="type-title text-2xl font-extrabold text-foreground sm:text-3xl">Olá, {firstName(adminName)}.</h1><p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">Convide professores, vincule matrículas e consulte dados em modo somente leitura.</p></div><Button variant="outline" className="h-10 w-fit shrink-0 rounded-xl" onClick={refresh}><RefreshCw aria-hidden="true" />Atualizar dados</Button></div>

      {notice && <Alert className="mb-5 border-[#D5E6CE] bg-[#F6FAF2]"><Check aria-hidden="true" /><AlertDescription className="flex items-center justify-between gap-3"><span>{notice}</span><Button variant="ghost" size="icon-xs" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button></AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="mb-5"><CircleAlert aria-hidden="true" /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription className="mt-2 flex items-center justify-between gap-3"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setError(null); refresh() }}>Tentar novamente</Button></AlertDescription></Alert>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[{title:'Professores pendentes', value:summary.professores_pendentes, icon:GraduationCap, tone:'warning' as const}, {title:'Alunos sem turma', value:summary.alunos_sem_turma, icon:Users, tone:'info' as const}, {title:'Turmas ativas', value:summary.turmas, icon:BookOpen, tone:'positive' as const}].map((item) => { const Icon = item.icon; return <KpiCard key={item.title} tile={{ id: item.title, label: item.title, value: loading ? null : item.value, icon: Icon, tone: item.tone }} /> })}
      </div>

      {tab === 'teachers' && <TeacherInvitesPanel classes={classes} revision={revision} />}

      {/* Legacy queue: public teacher signup is closed, so only accounts created
          before the invite flow can still be pending. Hidden when empty. */}
      {tab === 'teachers' && visibleApplications.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Professores aguardando análise</h2><p className="mt-1 text-sm text-muted-foreground">Cadastros antigos, feitos antes dos convites. Revise os dados informados; o acesso só é liberado após aprovação.</p></div><Badge variant="outline" className="rounded-full">{visibleApplications.length} pendentes</Badge></div>
          {loading ? <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div> : visibleApplications.length === 0 ? <EmptyState icon={GraduationCap} title="Nenhum cadastro pendente" body="Novas inscrições de professores aparecerão nesta fila." /> : <div className="space-y-3">{visibleApplications.map((application) => <Card key={application.id} className="border-0 shadow-none ring-1 ring-border"><CardContent className="flex flex-col justify-between gap-4 p-5 md:flex-row md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-bold">{application.nome}</h3><Badge variant="outline" className="rounded-full bg-[#FFF5DB] text-[#896622]">Aguardando aprovação</Badge></div><p className="mt-1 text-sm text-muted-foreground">{application.email}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Formação: <strong className="text-foreground">{application.formacao_academica}</strong></span><span>Atuação: <strong className="text-foreground">{application.area_atuacao}</strong></span><span>Documento: <strong className="text-foreground">{application.documento_tipo?.toUpperCase()} ·•••• {application.documento_final}</strong></span></div><p className="mt-2 text-[11px] text-muted-foreground">Cadastro em {formatDate(application.dataCriacao)}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" className="rounded-xl border-red-200 text-red-800 hover:bg-red-50" onClick={() => { setSelectedApplication(application); setDecision('reject') }}><X aria-hidden="true" />Reprovar</Button><Button className="rounded-xl" onClick={() => { setSelectedApplication(application); setDecision('approve') }}><Check aria-hidden="true" />Aprovar professor</Button></div></CardContent></Card>)}</div>}
        </div>
      )}


      {tab === 'students' && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="font-display text-xl font-bold">Alunos sem turma</h2><p className="mt-1 text-sm text-muted-foreground">Contas ativas aguardando vínculo a uma turma cadastrada.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar aluno" aria-label="Buscar aluno sem turma" className="h-10 w-full rounded-xl bg-white pl-9 sm:w-56" /></div><Button variant="outline" className="h-10 shrink-0 rounded-xl" onClick={() => setCreateClassOpen(true)}><Plus aria-hidden="true" />Nova turma</Button></div></div>
          {loading ? <div className="space-y-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div> : students.length === 0 ? <EmptyState icon={Users} title="Nenhum aluno sem turma" body="Novas contas de aluno aparecem nesta fila até que a administração faça o vínculo." /> : <div className="grid gap-3 md:grid-cols-2">{students.map((student) => <Card key={student.id} className="border-0 shadow-none ring-1 ring-border"><CardContent className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><h3 className="truncate font-semibold">{student.nome}</h3><p className="mt-1 text-xs text-muted-foreground">{student.data_nascimento ? `Nascimento: ${formatDate(student.data_nascimento)}` : 'Nascimento não informado'}</p></div><Button disabled={classes.length === 0} className="shrink-0 rounded-xl" onClick={() => { setSelectedStudent(student); setSelectedClassId(classes[0]?.id) }}>Vincular turma<ArrowRight aria-hidden="true" /></Button></CardContent></Card>)}</div>}
          {classes.length === 0 && <Alert className="border-[#E9E1CC] bg-[#FFFDF7]"><BookOpen aria-hidden="true" /><AlertDescription>Cadastre uma turma antes de vincular alunos. Nenhuma opção fictícia é exibida.</AlertDescription></Alert>}
        </div>
      )}


      {tab === 'classes' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Turmas cadastradas</h2><p className="mt-1 text-sm text-muted-foreground">Atribua professores aprovados para liberar as ferramentas docentes.</p></div><Button className="rounded-xl" onClick={() => setCreateClassOpen(true)}><Plus aria-hidden="true" />Nova turma</Button></div>
          {classes.length === 0 ? <EmptyState icon={BookOpen} title="Nenhuma turma cadastrada" body="Cadastre uma turma para começar a vincular alunos e professores." /> : <div className="grid gap-3 lg:grid-cols-2">{classes.map((item) => <Card key={item.id} className="border-0 shadow-none ring-1 ring-border"><CardContent className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"><div><h3 className="font-display font-bold">{item.nome}</h3><p className="mt-1 text-xs text-muted-foreground">{item.modalidade} · {item.ano} · {item.alunos_count}/{item.capacidade} alunos</p></div><div className="flex items-center gap-2"><Select items={teacherItems} value={item.professor_id ?? 'none'} onValueChange={(value) => { void api.setClassTeacher(item.id, typeof value === 'string' && value !== 'none' ? value : undefined).then(() => { setNotice('Professor da turma atualizado.'); refresh() }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o professor.')) }}><SelectTrigger className="h-10 w-full rounded-xl bg-white sm:w-56" aria-label={`Professor da turma ${item.nome}`}><SelectValue placeholder="Escolha professor" /></SelectTrigger><SelectContent><SelectItem value="none">Sem professor vinculado</SelectItem>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.nome}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="shrink-0 rounded-xl border-red-200 text-red-800 hover:bg-red-50" aria-label={`Excluir turma ${item.nome}`} disabled={classBusy} onClick={() => setDeleteClassTarget(item)}><Trash2 aria-hidden="true" /></Button></div></CardContent></Card>)}</div>}
          {teachers.length === 0 && <Alert className="border-[#E9E1CC] bg-[#FFFDF7]"><GraduationCap aria-hidden="true" /><AlertDescription>Nenhum professor aprovado está disponível para vinculação.</AlertDescription></Alert>}
        </div>
      )}


      {tab === 'teacher-tools' && (
        <div className="space-y-4">
          <div><h2 className="font-display text-xl font-bold">Área do professor <Badge variant="outline" className="ml-2 align-middle">Inspeção administrativa</Badge></h2><p className="mt-1 text-sm text-muted-foreground">Consulta somente leitura. Sua identidade e suas permissões continuam administrativas.</p></div>
          {teacherWorkspace.length === 0 ? <EmptyState icon={BookOpen} title="Nenhuma turma cadastrada" body="Crie ou vincule turmas antes da inspeção da área do professor." /> : <div className="grid gap-4 lg:grid-cols-2">{teacherWorkspace.map((item) => <Card key={item.id} className="border-0 shadow-none ring-1 ring-border"><CardHeader><CardTitle className="font-display">{item.nome}</CardTitle><CardDescription>{item.modalidade} · {item.ano} · {item.professor_nome}</CardDescription></CardHeader><CardContent><p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Alunos vinculados · {item.alunos.length}</p>{item.alunos.length === 0 ? <p className="text-sm text-muted-foreground">Ainda não há alunos nesta turma.</p> : <ul className="divide-y divide-border/70">{item.alunos.map((student) => <li key={student.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{student.nome}</span><Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setInspectionId(student.id); setTab('student-inspection') }}>Inspecionar<Eye aria-hidden="true" /></Button></li>)}</ul>}</CardContent></Card>)}</div>}
        </div>
      )}


      {tab === 'student-inspection' && (
        <div className="space-y-4">
          <div><h2 className="font-display text-xl font-bold">Área do aluno <Badge variant="outline" className="ml-2 align-middle">Somente leitura</Badge></h2><p className="mt-1 text-sm text-muted-foreground">Sem impersonação. Nenhuma ação será executada com a identidade do estudante.</p></div>
          {!inspectionId ? <Card className="border-0 shadow-none ring-1 ring-border"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Escolha “Inspecionar” em um aluno da área do professor.</p><Button variant="outline" className="mt-3 rounded-xl" onClick={() => setTab('teacher-tools')}>Ver turmas</Button></CardContent></Card> : inspectionLoading ? <Skeleton className="h-48 rounded-2xl" /> : inspection ? <StudentInspection snapshot={inspection} onClose={() => { setInspectionId(null); setInspection(null) }} /> : <Alert variant="destructive"><AlertDescription>Não foi possível carregar a inspeção. Tente novamente.</AlertDescription><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button></Alert>}
        </div>
      )}


      {tab === 'account' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold">Conta de administrador raiz</h2>
              <p className="mt-1 text-sm text-muted-foreground">Gerencie o acesso desta conta — senha e login com Google.</p>
            </div>
            <Badge variant="secondary" className="rounded-full bg-[#F1EEF7] text-[#63547F]">Acesso máximo</Badge>
          </div>

          <Card className="border-0 shadow-none ring-1 ring-border">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-5 text-[#668C5D]" />Dados da conta</CardTitle>
              <CardDescription>Informações públicas usadas pela escola para identificar o acesso.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[#F7F9F5] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Nome</p><p className="mt-1 font-semibold">{adminName}</p></div>
              <div className="rounded-xl bg-[#F7F9F5] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">E-mail</p><p className="mt-1 font-semibold">{adminEmail || 'Não informado'}</p></div>
              <div className="rounded-xl bg-[#F7F9F5] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Acesso com senha</p><p className="mt-1 font-semibold">{adminHasPassword ? 'Ativado' : 'Não definido'}</p></div>
              <div className="rounded-xl bg-[#F7F9F5] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Google</p><p className={`mt-1 font-semibold ${googleLinked ? 'text-[#426848]' : 'text-muted-foreground'}`}>{googleLinked ? `Vinculado · ${googleEmail || 'Conta Google'}` : 'Não vinculado'}</p></div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-none ring-1 ring-border">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2"><KeyRound aria-hidden="true" className="size-5" />Login com Google</CardTitle>
              <CardDescription>Vincule sua conta Google para entrar sem digitar senha. Desvincule se preferir acesso apenas por e-mail e senha.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {googleLinked ? (
                <Alert className="border-[#D8E5CF] bg-[#F5FAF1]">
                  <Check aria-hidden="true" />
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>Sua conta Google está vinculada: <strong>{googleEmail || 'Conta Google'}</strong></span>
                    <Button variant="outline" className="rounded-xl border-red-200 text-red-800 hover:bg-red-50 self-start sm:self-auto" disabled={googleUnlinkBusy || !adminHasPassword} onClick={() => void handleGoogleUnlink()}>
                      {googleUnlinkBusy ? 'Desvinculando…' : 'Desvincular Google'}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-[#D5E0CD] bg-[#FAFCF7] p-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-semibold">Sem conta Google vinculada</p>
                    <p className="mt-1 text-sm text-muted-foreground">Use o botão do Google para escolher a conta que corresponde ao seu e-mail administrativo.</p>
                    {!googleClientId && googleConfigLoaded && <p className="mt-2 text-xs text-amber-700">Acesso com Google não configurado no momento.</p>}
                    {!googleLinked && googleClientId && (
                      <div ref={googleLinkButtonRef} className="mt-3 flex min-h-[44px] items-center" />
                    )}
                  </div>
                  <Button className="rounded-xl" disabled={!googleClientId || googleLinkBusy} onClick={() => void handleGoogleLink()}>
                    {googleLinkBusy ? 'Aguardando Google…' : googleClientId ? 'Abrir seletor do Google' : 'Vincular conta Google'}
                  </Button>
                </div>
              )}
              {!adminHasPassword && googleLinked && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Senha não definida</AlertTitle>
                  <AlertDescription>Antes de desvincular o Google, crie uma senha nesta conta. Sem senha você perderá o acesso.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>

    <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !decisionBusy) { setDecision(null); setSelectedApplication(null); setRejectReason('') } }}>
      <DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">{decision === 'approve' ? 'Aprovar professor?' : 'Reprovar cadastro?'}</DialogTitle><DialogDescription>{selectedApplication ? `${selectedApplication.nome} · ${selectedApplication.email}` : ''}</DialogDescription></DialogHeader>
        {decision === 'approve' ? <p className="text-sm leading-6 text-muted-foreground">O professor poderá entrar e verá somente as turmas que estiverem vinculadas a ele.</p> : <Field><FieldLabel htmlFor="rejection-reason">Motivo da reprovação <span aria-hidden="true">*</span></FieldLabel><Textarea id="rejection-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} minLength={5} maxLength={1000} rows={4} className="mt-2 rounded-xl" placeholder="Explique brevemente a decisão" /><FieldDescription>Mínimo de 5 caracteres. O motivo será registrado para auditoria.</FieldDescription></Field>}
        <DialogFooter><Button variant="outline" disabled={decisionBusy} onClick={() => setDecision(null)}>Cancelar</Button><Button disabled={decisionBusy || (decision === 'reject' && rejectReason.trim().length < 5)} variant={decision === 'reject' ? 'destructive' : 'default'} onClick={() => void handleDecision()}>{decisionBusy ? 'Salvando…' : decision === 'approve' ? 'Confirmar aprovação' : 'Confirmar reprovação'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(selectedStudent)} onOpenChange={(open) => { if (!open && !assignmentBusy) setSelectedStudent(null) }}>
      <DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">Vincular aluno à turma</DialogTitle><DialogDescription>Confirme a matrícula de {selectedStudent?.nome ?? ''}.</DialogDescription></DialogHeader>
        {classes.length ? <Field><FieldLabel htmlFor="class-select">Turma disponível</FieldLabel><Select items={classes.map((classItem) => ({ value: classItem.id, label: `${classItem.nome} · ${classItem.alunos_count}/${classItem.capacidade}` }))} value={selectedClassId} onValueChange={(value) => setSelectedClassId(typeof value === 'string' ? value : undefined)}><SelectTrigger id="class-select" className="mt-2 h-11 w-full rounded-xl"><SelectValue placeholder="Escolha uma turma" /></SelectTrigger><SelectContent>{classes.map((classItem) => <SelectItem key={classItem.id} value={classItem.id} disabled={classItem.alunos_count >= classItem.capacidade}>{classItem.nome} · {classItem.alunos_count}/{classItem.capacidade}</SelectItem>)}</SelectContent></Select><FieldDescription>Turmas lotadas não podem receber novas matrículas.</FieldDescription></Field> : <Alert><AlertDescription>Nenhuma turma cadastrada.</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={() => setSelectedStudent(null)}>Cancelar</Button><Button disabled={!selectedClassId || assignmentBusy} onClick={() => void handleAssignment()}>{assignmentBusy ? 'Vinculando…' : 'Confirmar vínculo'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(deleteClassTarget)} onOpenChange={(open) => { if (!open && !deleteClassBusy) setDeleteClassTarget(null) }}>
      <DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">Excluir turma?</DialogTitle><DialogDescription>{deleteClassTarget ? `${deleteClassTarget.nome} · ${deleteClassTarget.modalidade} · ${deleteClassTarget.alunos_count} aluno(s) vinculado(s)` : ''}</DialogDescription></DialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">A turma será removida permanentemente. Os alunos vinculados ficarão sem turma (suas contas são mantidas) e o professor deixará de ter acesso às ferramentas desta turma. Esta ação não pode ser desfeita.</p>
        <DialogFooter><Button variant="outline" disabled={deleteClassBusy} onClick={() => setDeleteClassTarget(null)}>Cancelar</Button><Button variant="destructive" disabled={deleteClassBusy} onClick={() => void handleDeleteClass()}>{deleteClassBusy ? 'Excluindo…' : 'Excluir turma'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={createClassOpen} onOpenChange={setCreateClassOpen}>
      <DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">Cadastrar turma</DialogTitle><DialogDescription>A turma será usada para vincular alunos e atribuir um professor depois.</DialogDescription></DialogHeader>
        <form id="create-class-form" className="space-y-4" onSubmit={(event) => void handleCreateClass(event)}><Field><FieldLabel htmlFor="class-name">Nome da turma</FieldLabel><Input id="class-name" required minLength={3} maxLength={80} value={className} onChange={(event) => setClassName(event.target.value)} className="mt-2 h-11 rounded-xl" placeholder="Futsal sub-14" /></Field><Field><FieldLabel htmlFor="class-sport">Modalidade</FieldLabel><Input id="class-sport" required minLength={2} maxLength={40} value={sport} onChange={(event) => setSport(event.target.value)} className="mt-2 h-11 rounded-xl" placeholder="Futsal" /></Field><Field><FieldLabel htmlFor="new-class-teacher">Professor aprovado</FieldLabel><Select items={[{ value: 'none', label: 'Sem professor por enquanto' }, ...teacherItems.slice(1)]} value={newClassTeacher ?? 'none'} onValueChange={(value) => setNewClassTeacher(typeof value === 'string' && value !== 'none' ? value : undefined)}><SelectTrigger id="new-class-teacher" className="mt-2 h-11 w-full rounded-xl"><SelectValue placeholder="Sem professor por enquanto" /></SelectTrigger><SelectContent><SelectItem value="none">Sem professor por enquanto</SelectItem>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.nome}</SelectItem>)}</SelectContent></Select></Field><div className="grid grid-cols-2 gap-3"><Field><FieldLabel htmlFor="class-year">Ano</FieldLabel><Input id="class-year" type="number" min={2020} max={2100} required value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-2 h-11 rounded-xl" /></Field><Field><FieldLabel htmlFor="class-capacity">Capacidade</FieldLabel><Input id="class-capacity" type="number" min={1} max={500} required value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="mt-2 h-11 rounded-xl" /></Field></div></form>
        <DialogFooter><Button variant="outline" onClick={() => setCreateClassOpen(false)}>Cancelar</Button><Button type="submit" form="create-class-form" disabled={classBusy}>{classBusy ? 'Salvando…' : 'Criar turma'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  </AppShell>
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Users; title: string; body: string }) {
  return <Card className="border-dashed bg-white/70 shadow-none ring-1 ring-border"><CardContent className="flex flex-col items-center px-5 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><Icon aria-hidden="true" className="size-5" /></span><h3 className="mt-4 font-display font-bold">{title}</h3><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{body}</p></CardContent></Card>
}

function StudentInspection({ snapshot, onClose }: { snapshot: StudentPortalSnapshot; onClose: () => void }) {
  return <Card className="border-0 shadow-none ring-1 ring-border"><CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70"><div><CardTitle className="font-display">{snapshot.aluno.nome}</CardTitle><CardDescription>{snapshot.turma ? `${snapshot.turma.nome} · ${snapshot.turma.modalidade}` : 'Turma ainda não vinculada'}</CardDescription></div><Button variant="outline" className="rounded-xl" onClick={onClose}>Encerrar inspeção<X aria-hidden="true" /></Button></CardHeader><CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"><Info label="Professor" value={snapshot.professor_nome ?? 'Não informado'} /><Info label="Registros de presença" value={String(snapshot.presencas.length)} /><Info label="Avaliações" value={String(snapshot.avaliacoes.length)} /><Info label="Conquistas privadas" value={String(snapshot.conquistas.length)} /><Info label="Ocorrências" value={String(snapshot.ocorrencias.length)} /><Info label="Comunicados" value={String(snapshot.comunicados.length)} /></CardContent></Card>
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[#F7F9F5] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div> }










