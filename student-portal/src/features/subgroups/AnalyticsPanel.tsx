/**
 * AnalyticsPanel — estatísticas de frequência dos subgrupos (área do professor).
 *
 * Design (Padrão 2025): cards arredondados (rounded-2xl), sombras suaves,
 * bordas sutis, gradientes nos cards de resumo e total compatibilidade com o
 * modo escuro (tokens bg-card/text-foreground + classes dark:).
 * Gráficos: Recharts (responsivo, theme-aware via CSS variables).
 * Apenas leitura — nenhuma mutação, nenhum estado de negócio.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, CalendarDays, CircleAlert, Clock, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type AnalyticsResumo, type DailyPoint, type HourPoint, type StudentDetail, type StudentSummary } from '@/lib/api'

interface Props {
  turmaId: string
  alunos: { id: string; nome: string }[]
}

const axisStyle = { fontSize: 11, fill: 'var(--muted-foreground)' }
const tooltipStyle = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--foreground)',
  fontSize: 12,
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}min`
  if (minutes > 0) return `${minutes}min`
  return `${seconds}s`
}

function formatDate(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export function AnalyticsPanel({ turmaId, alunos }: Props) {
  const [subgroupId, setSubgroupId] = useState<string>('all')
  const [resumo, setResumo] = useState<AnalyticsResumo | null>(null)
  const [daily, setDaily] = useState<DailyPoint[]>([])
  const [hours, setHours] = useState<HourPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Visão individual
  const [alunoId, setAlunoId] = useState<string>(alunos[0]?.id ?? '')
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [summary, setSummary] = useState<StudentSummary | null>(null)
  const [mes, setMes] = useState<string>(() => new Date().toISOString().slice(0, 7))
  const [studentLoading, setStudentLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      api.resumo(turmaId, subgroupId === 'all' ? undefined : subgroupId),
      api.daily(turmaId, subgroupId === 'all' ? undefined : subgroupId),
      api.peakHours(turmaId, subgroupId === 'all' ? undefined : subgroupId),
    ])
      .then(([resumoData, dailyData, hoursData]) => {
        if (!active) return
        setResumo(resumoData)
        setDaily(dailyData.series)
        setHours(hoursData.horas)
        setError(null)
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as estatísticas.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [turmaId, subgroupId])

  useEffect(() => {
    if (!alunoId) return
    let active = true
    setStudentLoading(true)
    Promise.all([
      api.studentDetail(alunoId, mes || undefined),
      api.studentSummary(alunoId),
    ])
      .then(([detailData, summaryData]) => {
        if (!active) return
        setDetail(detailData)
        setSummary(summaryData)
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico do aluno.') })
      .finally(() => { if (active) setStudentLoading(false) })
    return () => { active = false }
  }, [alunoId, mes])

  const dailyChart = useMemo(() => daily.map((point) => ({ ...point, label: formatDate(point.data) })), [daily])

  return (
    <section className="space-y-6" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="analytics-heading" className="font-display text-xl font-bold tracking-tight text-heading">Estatísticas de frequência</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Movimentação das aulas em tempo real: presenças, tempo médio e horários de pico.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:scale-95" onClick={() => setSubgroupId((value) => (value === 'all' ? 'none' : 'all'))} hidden>
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Cards de resumo — gradiente suave, sombra difusa, cantos generosos */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <SummaryCard
              icon={<Users aria-hidden="true" className="size-5" />}
              label="Alunos hoje"
              value={String(resumo?.alunos_hoje ?? 0)}
              hint="passaram pelo grupo hoje"
              gradient="from-emerald-600 to-teal-700"
            />
            <SummaryCard
              icon={<Clock aria-hidden="true" className="size-5" />}
              label="Tempo médio"
              value={resumo?.tempo_medio ?? '—'}
              hint="permanência nos últimos 7 dias"
              gradient="from-blue-600 to-indigo-700"
            />
            <SummaryCard
              icon={<Activity aria-hidden="true" className="size-5" />}
              label="Sessões (7 dias)"
              value={String(resumo?.sessoes_7d ?? 0)}
              hint="check-ins na semana"
              gradient="from-amber-500 to-orange-600"
            />
            <SummaryCard
              icon={<CalendarDays aria-hidden="true" className="size-5" />}
              label="Total de sessões"
              value={String(resumo?.total_sessoes ?? 0)}
              hint="histórico completo"
              gradient="from-violet-600 to-purple-700"
            />
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Movimentação diária */}
        <Card className="rounded-2xl border-border shadow-lg shadow-slate-200/50 transition-all duration-300 hover:shadow-xl dark:bg-card dark:shadow-black/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base font-bold text-heading">Movimentação diária</CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">Alunos únicos por dia (últimos 30 dias)</p>
          </CardHeader>
          <CardContent className="h-64 px-2">
            {loading ? <Skeleton className="h-full rounded-xl" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChart} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="alunos" name="Alunos" stroke="#0d9488" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="sessoes" name="Check-ins" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Horários de pico */}
        <Card className="rounded-2xl border-border shadow-lg shadow-slate-200/50 transition-all duration-300 hover:shadow-xl dark:bg-card dark:shadow-black/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base font-bold text-heading">Horários de pico</CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">Entradas e saídas por hora do dia (últimos 30 dias)</p>
          </CardHeader>
          <CardContent className="h-64 px-2">
            {loading ? <Skeleton className="h-full rounded-xl" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
                  <Bar dataKey="entradas" name="Entradas" fill="#0d9488" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="saidas" name="Saídas" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Visão individual */}
      <Card className="rounded-2xl border-border shadow-lg shadow-slate-200/50 dark:bg-card dark:shadow-black/30">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-bold text-heading">Histórico individual</CardTitle>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Select items={alunos.map((aluno) => ({ value: aluno.id, label: aluno.nome }))} value={alunoId} onValueChange={(value) => { if (typeof value === 'string') setAlunoId(value) }}>
              <SelectTrigger className="h-10 w-56 rounded-xl border-border bg-input focus:outline-none focus:ring-2 focus:ring-ring/50"><SelectValue placeholder="Escolha o aluno" /></SelectTrigger>
              <SelectContent>{alunos.map((aluno) => <SelectItem key={aluno.id} value={aluno.id}>{aluno.nome}</SelectItem>)}</SelectContent>
            </Select>
            <Input
              type="month"
              value={mes}
              onChange={(event) => setMes(event.target.value)}
              className="h-10 w-44 rounded-xl border-border bg-input focus:outline-none focus:ring-2 focus:ring-ring/50"
              aria-label="Mês do histórico"
            />
            {summary && (
              <div className="ml-auto rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 px-4 py-2 text-white shadow-md">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Frequência</p>
                <p className="font-display text-lg font-bold leading-none">{summary.mes_atual.frequencia_pct}%</p>
              </div>
            )}
          </div>
          {summary && (
            <p className="pt-1 text-xs text-muted-foreground">
              {summary.mes_atual.dias_participados} dias no mês atual · {summary.mes_anterior.dias_participados} dias no mês anterior
            </p>
          )}
        </CardHeader>
        <CardContent>
          {studentLoading ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : !detail || detail.sessoes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhuma sessão registrada neste mês.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Data</th>
                    <th className="px-4 py-3 font-semibold">Aula</th>
                    <th className="px-4 py-3 font-semibold">Entrada</th>
                    <th className="px-4 py-3 font-semibold">Saída</th>
                    <th className="px-4 py-3 font-semibold">Permanência</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sessoes.map((session, index) => (
                    <tr key={index} className="border-t border-border/70 transition-colors duration-200 hover:bg-muted/50">
                      <td className="px-4 py-2.5 font-medium">{new Date(session.entrada).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{session.subgrupo_nome ?? 'Turma'}</td>
                      <td className="px-4 py-2.5 tabular-nums">{new Date(session.entrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-2.5 tabular-nums">{session.saida ? new Date(session.saida).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : <span className="font-semibold text-emerald-600 dark:text-emerald-400">Em aula</span>}</td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold">{formatDuration(session.tempo_permanencia_segundos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function SummaryCard({ icon, label, value, hint, gradient }: { icon: React.ReactNode; label: string; value: string; hint: string; gradient: string }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradient} p-6 text-white shadow-lg transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-xl active:scale-95`}>
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/15">{icon}</div>
        <p className="text-xs font-bold uppercase tracking-wider text-white/75">{label}</p>
      </div>
      <p className="mt-3 font-display text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-white/70">{hint}</p>
    </div>
  )
}
