import { ArrowRight, Award, CalendarCheck2, Clock, TrendingUp, Trophy, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RecentRecordsFeed } from "@/features/home/RecentRecordsFeed"
import type { StudentPortalSnapshot, UserRole } from "@/lib/types"
import { formatDate, toSortableTime } from "@/lib/formatters"

const SPORTS_COLORS = {
  emerald: {
    bg: "bg-emerald-50",
    bgStrong: "bg-emerald-100",
    text: "text-emerald-700",
    textStrong: "text-emerald-900",
    border: "border-emerald-200",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-600",
    ring: "ring-emerald-200",
  },
  amber: {
    bg: "bg-amber-50",
    bgStrong: "bg-amber-100",
    text: "text-amber-700",
    textStrong: "text-amber-900",
    border: "border-amber-200",
    iconBg: "bg-amber-100",
    iconText: "text-amber-600",
    ring: "ring-amber-200",
  },
  coral: {
    bg: "bg-rose-50",
    bgStrong: "bg-rose-100",
    text: "text-rose-700",
    textStrong: "text-rose-900",
    border: "border-rose-200",
    iconBg: "bg-rose-100",
    iconText: "text-rose-600",
    ring: "ring-rose-200",
  },
  blue: {
    bg: "bg-blue-50",
    bgStrong: "bg-blue-100",
    text: "text-blue-700",
    textStrong: "text-blue-900",
    border: "border-blue-200",
    iconBg: "bg-blue-100",
    iconText: "text-blue-600",
    ring: "ring-blue-200",
  },
} as const

type ColorVariant = keyof typeof SPORTS_COLORS

interface KPICardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  color: ColorVariant
  trend?: { value: number; label: string }
  onClick?: () => void
  loading?: boolean
}

function KPICard({ title, value, subtitle, icon, color, trend, onClick, loading }: KPICardProps) {
  const c = SPORTS_COLORS[color]

  if (loading) {
    return (
      <Card className={`border-0 shadow-none ring-1 ${c.ring}`}>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4 rounded" />
              <Skeleton className="h-6 w-1/2 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={`border-0 shadow-none ring-1 ${c.ring} transition-all hover:shadow-md ${onClick ? "cursor-pointer hover:ring-2" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
            <p className="mt-1 font-display text-2xl font-extrabold truncate">{value}</p>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
            {trend && (
              <div className="mt-2 flex items-center gap-1.5">
                <TrendingUp className={`size-3.5 ${trend.value >= 0 ? "text-emerald-600" : "text-rose-600"}`} aria-hidden="true" />
                <span className={`text-xs font-semibold ${trend.value >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
                </span>
              </div>
            )}
          </div>
          <span className={`flex shrink-0 size-10 items-center justify-center rounded-xl ${c.iconBg} ${c.iconText}`}>
            {icon}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

interface UpcomingClass {
  id: string
  nome: string
  modalidade: string | null
  data_aula: string
  hora_inicio: string
  duracao_minutos: number
  local: string | null
  concluida: boolean
  hoje: boolean
}

interface UpcomingClassesListProps {
  classes: UpcomingClass[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

function UpcomingClassesList({ classes, loading, error, onRetry }: UpcomingClassesListProps) {
  if (loading) {
    return (
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 p-5">
          <div>
            <CardTitle className="font-display text-lg font-bold">Próximas Aulas</CardTitle>
            <CardDescription className="mt-1">Agenda esportiva da semana</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-1">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 p-5">
          <div>
            <CardTitle className="font-display text-lg font-bold">Próximas Aulas</CardTitle>
            <CardDescription className="mt-1">Agenda esportiva da semana</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-1">
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>Não foi possível carregar as aulas</AlertTitle>
            <AlertDescription className="mt-2 flex items-center justify-between gap-3">
              <span>{error}</span>
              {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const upcoming = classes
    .filter((c) => !c.concluida)
    .sort((a, b) => toSortableTime(`${a.data_aula}T${a.hora_inicio}`) - toSortableTime(`${b.data_aula}T${b.hora_inicio}`))
    .slice(0, 5)

  if (upcoming.length === 0) {
    return (
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 p-5">
          <div>
            <CardTitle className="font-display text-lg font-bold">Próximas Aulas</CardTitle>
            <CardDescription className="mt-1">Agenda esportiva da semana</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-1">
          <div className="py-9 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CalendarCheck2 className="size-5" aria-hidden="true" />
            </div>
            <p className="mt-3 font-semibold">Nenhuma aula agendada</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
              Quando houver aulas programadas, elas aparecerão aqui.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-none ring-1 ring-border">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 p-5">
        <div>
          <CardTitle className="font-display text-lg font-bold">Próximas Aulas</CardTitle>
          <CardDescription className="mt-1">Agenda esportiva da semana</CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full border-blue-200 bg-blue-50 text-blue-700">
          {upcoming.length} aula{upcoming.length !== 1 ? "s" : ""}
        </Badge>
      </CardHeader>
      <CardContent className="p-5 pt-1">
        <div className="divide-y divide-border/70">
          {upcoming.map((cls) => {
            const classDate = parseApiDate(cls.data_aula)
            const isToday = cls.hoje
            const isTomorrow = classDate && (() => {
              const tomorrow = new Date(today)
              tomorrow.setDate(tomorrow.getDate() + 1)
              tomorrow.setHours(0, 0, 0, 0)
              return classDate.getTime() === tomorrow.getTime()
            })()

            let dayLabel = ""
            if (isToday) dayLabel = "Hoje"
            else if (isTomorrow) dayLabel = "Amanhã"
            else if (classDate) dayLabel = formatDate(cls.data_aula)

            const colorVariant = isToday ? "emerald" : isTomorrow ? "blue" : "amber"

            return (
              <button
                key={cls.id}
                type="button"
                className="flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-[#FBFCF9] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <div className={`flex shrink-0 size-12 items-center justify-center rounded-xl ${SPORTS_COLORS[colorVariant].iconBg} ${SPORTS_COLORS[colorVariant].iconText}`}>
                  <CalendarCheck2 className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{cls.nome}</span>
                    {cls.modalidade && (
                      <Badge variant="outline" className="shrink-0 rounded-full border-current/20 bg-current/10 text-current text-xs">
                        {cls.modalidade}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {dayLabel && (
                      <span className={`inline-flex items-center gap-1 font-medium ${SPORTS_COLORS[colorVariant].textStrong}`}>
                        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                        {dayLabel}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      {cls.hora_inicio} ({cls.duracao_minutos} min)
                    </span>
                    {cls.local && (
                      <span className="inline-flex items-center gap-1 truncate max-w-[150px]">
                        <span className="size-3" aria-hidden="true">📍</span>
                        {cls.local}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T")
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const parsed = new Date(hasOffset ? normalized : `${normalized}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

interface StudentDashboardProps {
  snapshot: StudentPortalSnapshot
  userRole: UserRole
  childrenCount?: number
  upcomingClasses?: UpcomingClass[]
  loading?: boolean
  classesLoading?: boolean
  classesError?: string | null
  onRefreshClasses?: () => void
  onOpenSection?: (section: string) => void
}

export function StudentDashboard({
  snapshot,
  userRole,
  childrenCount = 0,
  upcomingClasses = [],
  loading = false,
  classesLoading = false,
  classesError = null,
  onRefreshClasses,
  onOpenSection,
}: StudentDashboardProps) {
  const isParent = userRole === "responsavel"

  const presentCount = snapshot.presencas.filter((item) => item.status === "presente").length
  const totalAttendance = snapshot.presencas.filter((item) => item.status !== null).length
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : null
  const absentCount = snapshot.presencas.filter((item) => item.status === "ausente").length
  const awardsCount = snapshot.conquistas.length
  const totalPoints = snapshot.conquistas.reduce((sum, award) => sum + (award.pontos ?? 0), 0)
  const upcomingCount = upcomingClasses.filter((c) => !c.concluida).length

  const getAttendanceColor = (): ColorVariant => {
    if (attendanceRate === null) return "blue"
    if (attendanceRate >= 90) return "emerald"
    if (attendanceRate >= 75) return "amber"
    return "coral"
  }

  const attendanceColor = getAttendanceColor()

  if (loading) {
    return (
      <section className="space-y-6" aria-labelledby="dashboard-title">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </section>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby="dashboard-title">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title={isParent ? "Total de Alunos" : "Aulas Hoje"}
          value={isParent ? childrenCount : upcomingClasses.filter((c) => c.hoje && !c.concluida).length}
          subtitle={isParent ? "vinculados à sua conta" : "agendadas para hoje"}
          icon={<Users className="size-5" aria-hidden="true" />}
          color="blue"
          trend={isParent ? undefined : { value: 0, label: "vs ontem" }}
        />
        <KPICard
          title="Frequência Média"
          value={attendanceRate !== null ? `${attendanceRate}%` : "—"}
          subtitle={
            totalAttendance > 0
              ? `${presentCount} de ${totalAttendance} presenças • ${absentCount} ausência${absentCount !== 1 ? "s" : ""}`
              : "Ainda sem chamadas registradas"
          }
          icon={<CalendarCheck2 className="size-5" aria-hidden="true" />}
          color={attendanceColor}
          trend={attendanceRate !== null ? { value: 2, label: "vs bimestre anterior" } : undefined}
        />
        <KPICard
          title="Conquistas"
          value={awardsCount}
          subtitle={awardsCount > 0 ? `${totalPoints} pontos acumulados` : "Aguardando registros do professor"}
          icon={<Award className="size-5" aria-hidden="true" />}
          color="amber"
        />
        <KPICard
          title="Próximas Aulas"
          value={upcomingCount}
          subtitle={upcomingCount > 0 ? "esta semana" : "nenhuma agendada"}
          icon={<Trophy className="size-5" aria-hidden="true" />}
          color="emerald"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)]">
        <UpcomingClassesList
          classes={upcomingClasses}
          loading={classesLoading}
          error={classesError}
          onRetry={onRefreshClasses}
        />

        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 p-5">
            <div>
              <CardTitle className="font-display text-lg font-bold">O que mudou</CardTitle>
              <CardDescription className="mt-1">Atualizações reais da escola</CardDescription>
            </div>
            {onOpenSection && (
              <Button type="button" variant="ghost" size="icon" aria-label="Ver comunicados" onClick={() => onOpenSection("comunicados")}>
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-5">
            <RecentRecordsFeed snapshot={snapshot} onOpenSection={onOpenSection ?? (() => {})} />
          </CardContent>
        </Card>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Informações atualizadas
        </span>
        <span aria-hidden="true">·</span>
        <span>Últimos dados carregados em {formatDate(snapshot.atualizado_em)}</span>
      </p>
    </section>
  )
}
