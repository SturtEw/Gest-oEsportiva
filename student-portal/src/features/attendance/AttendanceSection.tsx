import { useMemo, useState } from 'react'
import { CalendarCheck2, Check, Clock3, Filter, HelpCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AttendanceStatus, StudentAttendance } from '@/lib/types'
import { formatDate } from '@/lib/formatters'

const labels: Record<AttendanceStatus, string> = {
  presente: 'Presente',
  ausente: 'Ausente',
  justificada: 'Justificada',
}

const styles: Record<AttendanceStatus, string> = {
  presente: 'bg-surface-tint text-on-soft ring-[#D6E5D0]',
  ausente: 'bg-[#FFF0E9] text-[#9B5737] ring-[#F2D8C8]',
  justificada: 'bg-[#F1EEF7] text-[#63547F] ring-[#E2DDEE]',
}

function AttendanceList({ items }: { items: StudentAttendance[] }) {
  if (items.length === 0) return <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">Ainda não há registros nesta seção.</div>
  return <ul className="divide-y divide-border/70">
    {items.map((item) => {
      const status = item.status
      return <li key={`${item.chamada_id}-${item.turma_id}`} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-soft text-muted-strong"><CalendarCheck2 aria-hidden="true" className="size-5" /></div>
          <div className="min-w-0"><p className="font-semibold">{formatDate(item.data_aula)}</p><p className="mt-0.5 text-xs text-muted-foreground">Chamada da turma</p></div>
        </div>
        {status ? <Badge variant="outline" className={`h-7 gap-1.5 rounded-full px-3 ring-1 ring-inset ${styles[status]}`}><Check aria-hidden="true" className="size-3" />{labels[status]}</Badge> : <Badge variant="outline" className="h-7 gap-1.5 rounded-full px-3 text-muted-foreground"><HelpCircle aria-hidden="true" className="size-3" />Não informado</Badge>}
      </li>
    })}
  </ul>
}

export function AttendanceSection({ attendance }: { attendance: StudentAttendance[] }) {
  const [filter, setFilter] = useState<'todos' | AttendanceStatus | 'nao_informado'>('todos')
  const ordered = useMemo(() => [...attendance].sort((a, b) => b.data_aula.localeCompare(a.data_aula)), [attendance])
  const filtered = useMemo(() => ordered.filter((item) => {
    if (filter === 'todos') return true
    if (filter === 'nao_informado') return item.status === null
    return item.status === filter
  }), [filter, ordered])
  const counts = useMemo(() => ({
    presente: attendance.filter((item) => item.status === 'presente').length,
    ausente: attendance.filter((item) => item.status === 'ausente').length,
    justificada: attendance.filter((item) => item.status === 'justificada').length,
    nao_informado: attendance.filter((item) => item.status === null).length,
  }), [attendance])

  return (
    <section className="space-y-5" aria-labelledby="attendance-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-eyebrow"><CalendarCheck2 className="size-4" />Seus registros</p>
        <h2 id="attendance-title" className="type-title mt-2 text-3xl font-extrabold text-heading">Presenças</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Veja somente os seus registros de chamada. Um campo sem registro aparece como “Não informado”, não como falta.</p>
      </div>
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader className="border-b border-border/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2 font-display text-xl font-bold"><Filter className="size-5 text-[#668C5D]" />Histórico de chamadas</CardTitle><CardDescription className="mt-1">{attendance.length} registros encontrados</CardDescription></div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-surface-tint px-2.5 py-1 font-semibold text-on-soft">{counts.presente} presentes</span>
              <span className="rounded-full bg-[#FFF0E9] px-2.5 py-1 font-semibold text-[#9B5737]">{counts.ausente} ausentes</span>
              <span className="rounded-full bg-[#F1EEF7] px-2.5 py-1 font-semibold text-[#63547F]">{counts.justificada} justificadas</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <TabsList aria-label="Filtrar presenças" className="mb-5 flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-[#F2F5EF] p-1 sm:w-fit">
              <TabsTrigger value="todos" className="min-h-9 rounded-lg px-3 text-xs">Todas ({attendance.length})</TabsTrigger>
              <TabsTrigger value="presente" className="min-h-9 rounded-lg px-3 text-xs">Presente ({counts.presente})</TabsTrigger>
              <TabsTrigger value="ausente" className="min-h-9 rounded-lg px-3 text-xs">Ausente ({counts.ausente})</TabsTrigger>
              <TabsTrigger value="justificada" className="min-h-9 rounded-lg px-3 text-xs">Justificada ({counts.justificada})</TabsTrigger>
              <TabsTrigger value="nao_informado" className="min-h-9 rounded-lg px-3 text-xs">Não informado ({counts.nao_informado})</TabsTrigger>
            </TabsList>
            <TabsContent value={filter} className="min-h-44"><AttendanceList items={filtered} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-4" />As alterações de presença podem levar um momento para aparecer se a sincronização estiver reconectando.</p>
    </section>
  )
}
