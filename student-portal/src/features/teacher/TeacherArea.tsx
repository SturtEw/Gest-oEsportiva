import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, CircleHelp, Flag, LayoutDashboard, MessageCircle, Send, Trophy, UserPlus, Users, X, type LucideIcon } from 'lucide-react'
import { AppShell, type NavItem } from '@/components/AppShell'
import { PageHeading } from '@/components/PageHeading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useImpersonation } from '@/hooks/useImpersonation'
import { useTeacherEnrollment } from '@/hooks/useTeacherEnrollment'
import { api, teacherApi } from '@/lib/api'
import { formatDateTime, firstName, initials } from '@/lib/formatters'
import type { PublicMessage, TeacherClass } from '@/lib/types'
import { TeacherDashboard } from './dashboard/TeacherDashboard'
import { UpcomingClasses } from './dashboard/UpcomingClasses'
import { RoleSelector } from '@/components/RoleSelector'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { TeacherActivitiesView, TeacherEnrollmentPanel, prefetchTeacherView } from './sections'

type View = 'dashboard' | 'turmas' | 'atividades' | 'convites' | 'alunos' | 'agenda'

interface Student { id: string; nome: string; turma_id: string }

interface ViewMeta { label: string; short: string; icon: LucideIcon; eyebrow: string; description: string }

/** Navigation label + page title block of each teacher section (mirrors the student area). */
const VIEWS: Record<View, ViewMeta> = {
  dashboard: { label: 'Painel', short: 'Painel', icon: LayoutDashboard, eyebrow: 'Visão geral', description: 'Aulas de hoje, a agenda à frente e como cada turma e aluno está indo.' },
  turmas: { label: 'Turmas', short: 'Turmas', icon: Users, eyebrow: 'Suas turmas', description: 'Os alunos de cada turma. Abra as dúvidas de um aluno ou registre uma conquista.' },
  atividades: { label: 'Atividades', short: 'Atividades', icon: Flag, eyebrow: 'Torneios e eventos', description: 'Crie quantas atividades quiser para suas turmas. Os alunos marcam interesse; você monta os times, o chaveamento e registra os placares.' },
  convites: { label: 'Convites e pedidos', short: 'Convites', icon: UserPlus, eyebrow: 'Matrículas', description: 'Gere códigos para os alunos entrarem direto nas suas turmas e responda aos pedidos de quem se cadastrou sem código.' },
  alunos: { label: 'Alunos', short: 'Alunos', icon: Trophy, eyebrow: 'Seus alunos', description: 'Todos os alunos das suas turmas em um só lugar.' },
  agenda: { label: 'Agenda', short: 'Agenda', icon: CalendarDays, eyebrow: 'Próximos 14 dias', description: 'As aulas marcadas para as próximas duas semanas. Para agendar uma aula, use o Painel.' },
}

export function TeacherArea({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard')
  const [classes, setClasses] = useState<TeacherClass[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeStudent, setActiveStudent] = useState<Student | null>(null)
  const [messages, setMessages] = useState<PublicMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [awardTarget, setAwardTarget] = useState<Student | null>(null)
  const [awardName, setAwardName] = useState('')
  const [awardPoints, setAwardPoints] = useState(10)
  const [savingAward, setSavingAward] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const { isImpersonating } = useImpersonation()
  const onInvalidate = useCallback(() => setRevision((value) => value + 1), [])
  const connection = useRealtimeSync({ audience: 'teacher', enabled: !isImpersonating, onInvalidate })
  // Approving a request changes the roster, so mutations bump the shared revision.
  const enrollment = useTeacherEnrollment({ revision, onChanged: onInvalidate })

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.teacherDashboard(), api.teacherStudents()])
      .then(([dashboard, roster]) => { if (active) { setClasses(dashboard.classes); setStudents(roster.students) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas turmas.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  useEffect(() => {
    if (!activeStudent) { setMessages([]); return }
    let active = true
    setMessagesLoading(true)
    api.teacherQuestions(activeStudent.id)
      .then((items) => { if (active) setMessages(items) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a conversa.') })
      .finally(() => { if (active) setMessagesLoading(false) })
    return () => { active = false }
  }, [activeStudent])

  const studentsByClass = useMemo(() => {
    const map = new Map<string, Student[]>()
    for (const student of students) map.set(student.turma_id, [...(map.get(student.turma_id) ?? []), student])
    return map
  }, [students])

  const openStudentById = (id: string) => {
    const found = students.find((item) => item.id === id)
    if (found) setActiveStudent(found)
  }

  const nav: NavItem[] = useMemo(() => {
    const item = (id: View, extra?: Partial<NavItem>): NavItem => ({ id, label: VIEWS[id].label, short: VIEWS[id].short, icon: VIEWS[id].icon, ...extra })
    return [
      item('dashboard'),
      item('turmas', { badge: classes.length || undefined, badgeVariant: 'emerald' }),
      item('atividades'),
      item('convites', { badge: enrollment.pendingCount || undefined, badgeVariant: 'amber' }),
      item('alunos'),
      item('agenda'),
    ]
  }, [classes.length, enrollment.pendingCount])
  const meta = VIEWS[view]

  const sendReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeStudent || !draft.trim() || sending) return
    setSending(true)
    try {
      const response = await api.replyToStudent(activeStudent.id, draft.trim())
      setMessages((current) => [...current, response])
      setDraft('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a resposta.') }
    finally { setSending(false) }
  }

  const saveAward = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!awardTarget || !awardName.trim() || awardPoints < 1) return
    setSavingAward(true)
    try {
      await teacherApi.award(awardTarget.id, awardName.trim(), awardPoints)
      setNotice(`Conquista registrada para ${firstName(awardTarget.nome)} com ${awardPoints} pontos.`)
      setAwardTarget(null)
      setAwardName('')
      setAwardPoints(10)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a conquista.') }
    finally { setSavingAward(false) }
  }, [awardName, awardPoints, awardTarget])

  return (
    <>
      <AppShell
        nav={nav}
        active={view}
        onNavigate={(id) => setView(id as View)}
        onPrefetch={prefetchTeacherView}
        roleLabel="Professor"
        userName={name}
        subtitle={`Olá, ${firstName(name)} · suas turmas, aulas e alunos`}
        monogram={initials(name)}
        onLogout={onLogout}
        connection={connection}
        headerEnd={<RoleSelector />}
      >
        {notice && (
          <Alert className="mb-4 border-[#D5E6CE] bg-[#F6FAF2]">
            <AlertDescription className="flex items-center justify-between gap-3">
              {notice}
              <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="rounded p-1 hover:bg-black/5">
                <X className="size-4" />
              </button>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <CircleHelp aria-hidden="true" />
            <AlertDescription className="flex items-center justify-between gap-3">
              {error}
              <Button variant="outline" size="sm" onClick={() => { setError(null); setRevision((value) => value + 1) }}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <section aria-labelledby="teacher-section-title" className="space-y-5">
        {/* Outside the boundary: if the section crashes the title stays. */}
        <PageHeading id="teacher-section-title" as="h1" icon={meta.icon} eyebrow={meta.eyebrow} title={meta.label} description={meta.description} />
        <SectionErrorBoundary key={view} label={meta.label}>
        <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        {view === 'dashboard' && <TeacherDashboard onOpenStudent={openStudentById} />}

        {view === 'turmas' && (
          loading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" />
            </div>
          ) : classes.length === 0 ? (
            <EmptyState
              title="Nenhuma turma vinculada"
              message="A administração precisa vincular uma turma para você acessar os alunos."
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {classes.map((classItem) => (
                <Card key={classItem.id} className="ring-1 ring-border">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="font-display">{classItem.nome}</CardTitle>
                        <CardDescription className="mt-1">
                          {[classItem.modalidade, classItem.ano].filter(Boolean).join(' · ')}
                        </CardDescription>
                      </div>
                      <Badge className="shrink-0 rounded-full bg-muted text-muted-foreground">
                        {classItem.total_alunos}/{classItem.capacidade || '—'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Alunos vinculados</p>
                    {(studentsByClass.get(classItem.id) ?? []).length === 0 ? (
                      <p className="py-5 text-sm text-muted-foreground">Ainda não há alunos nesta turma.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-border/70">
                        {(studentsByClass.get(classItem.id) ?? []).map((student) => (
                          <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                            <span className="min-w-0 flex-1 truncate font-semibold">{student.nome}</span>
                            <span className="flex shrink-0 gap-2">
                              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setActiveStudent(student)}>
                                <MessageCircle className="size-4" />
                                Dúvidas
                              </Button>
                              <Button variant="secondary" size="sm" className="rounded-lg" disabled={isImpersonating} onClick={() => setAwardTarget(student)}>
                                <Trophy className="size-4" />
                                Conquista
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        )}

        {view === 'alunos' && (
          loading ? (
            <Skeleton className="h-96 rounded-2xl" />
          ) : students.length === 0 ? (
            <EmptyState title="Nenhum aluno vinculado" message="Assim que a administração vincular alunos às suas turmas, eles aparecem aqui." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {students.map((student) => {
                const turma = classes.find((item) => item.id === student.turma_id)
                return (
                  <Card key={student.id} className="ring-1 ring-border">
                    <CardContent className="flex items-center gap-3 p-4">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden="true">
                        {initials(student.nome)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{student.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">{turma?.nome ?? 'Sem turma'}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setActiveStudent(student)} aria-label={`Dúvidas de ${student.nome}`}>
                          <MessageCircle className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" disabled={isImpersonating} onClick={() => setAwardTarget(student)} aria-label={`Registrar conquista para ${student.nome}`}>
                          <Trophy className="size-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )
        )}

        {view === 'atividades' && <TeacherActivitiesView revision={revision} live={connection.status === 'live'} readOnly={isImpersonating} onNotice={setNotice} />}

        {view === 'convites' && <TeacherEnrollmentPanel enrollment={enrollment} readOnly={isImpersonating} />}

        {view === 'agenda' && <AgendaView revision={revision} />}
        </Suspense>
        </SectionErrorBoundary>
        </section>
      </AppShell>

      <Dialog open={Boolean(activeStudent)} onOpenChange={(open) => { if (!open) { setActiveStudent(null); setMessages([]); setDraft('') } }}>
        <DialogContent className="rounded-3xl p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border/70 p-5">
            <DialogTitle className="font-display">Dúvidas de {activeStudent?.nome}</DialogTitle>
            <DialogDescription>Conversa privada com este aluno ou responsável vinculado.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto p-5">
            {messagesLoading ? (
              <p className="text-sm text-muted-foreground">Carregando conversa…</p>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Ainda não há dúvidas nesta conversa.</p>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[88%] rounded-2xl px-4 py-3 ${message.autor_tipo === 'professor' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
              >
                <div className="text-[11px] opacity-70">{message.autor_nome} · {formatDateTime(message.dataEnvio)}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.texto}</p>
              </article>
            ))}
          </div>
          {activeStudent && !isImpersonating && (
            <form onSubmit={(event) => void sendReply(event)} className="border-t border-border/70 p-5">
              <Field>
                <FieldLabel htmlFor="teacher-reply">Sua resposta</FieldLabel>
                <Textarea
                  id="teacher-reply" value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                  rows={3} maxLength={2000} className="mt-2 rounded-xl" placeholder="Escreva sua resposta…"
                />
              </Field>
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={!draft.trim() || sending}>
                  {sending ? 'Enviando…' : 'Enviar resposta'}
                  <Send className="size-4" />
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(awardTarget)} onOpenChange={(open) => { if (!open && !savingAward) setAwardTarget(null) }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Registrar uma conquista</DialogTitle>
            <DialogDescription>
              Professor define o nome e a pontuação.
              {awardTarget ? ` Para ${firstName(awardTarget.nome)}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <form id="teacher-award-form" onSubmit={(event) => void saveAward(event)} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="award-name">Conquista</FieldLabel>
              <Input
                id="award-name" required minLength={2} maxLength={120} value={awardName}
                onChange={(event) => setAwardName(event.target.value)}
                placeholder="Ex.: Trabalho em equipe" className="mt-2 h-11 rounded-xl"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="award-points">Pontos atribuídos</FieldLabel>
              <Input
                id="award-points" type="number" min={1} max={10000} required value={awardPoints}
                onChange={(event) => setAwardPoints(Number(event.target.value))} className="mt-2 h-11 rounded-xl"
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAwardTarget(null)}>Cancelar</Button>
            <Button form="teacher-award-form" type="submit" disabled={savingAward}>
              {savingAward ? 'Salvando…' : 'Registrar conquista'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-dashed ring-1 ring-border">
      <CardContent className="p-10 text-center">
        <Users className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 font-display font-bold">{title}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

function AgendaView({ revision }: { revision: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof teacherApi.schedule>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    teacherApi.schedule(14)
      .then((result) => { if (active) { setData(result); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a agenda.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  if (loading) return <Skeleton className="h-96 rounded-2xl" />
  if (error) return <Alert variant="destructive"><CircleHelp aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>

  return <UpcomingClasses aulas={data?.aulas ?? []} emptyHint="Crie a primeira aula no painel para organizar sua semana." />
}
