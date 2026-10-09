import { useMemo } from 'react'
import { AlertCircle, CheckCircle2, Clock3, FileCheck2, HeartPulse } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentIncident, StudentJustification } from '@/lib/types'
import { formatDate } from '@/lib/formatters'

const justificationCopy = {
  pendente: { label: 'Pendente', className: 'bg-[#FFF5DB] text-[#896622]' },
  aprovada: { label: 'Aprovada', className: 'bg-surface-tint text-on-soft' },
  rejeitada: { label: 'Rejeitada', className: 'bg-[#FFF0E9] text-[#9B5737]' },
}

export function RecordsSection({ incidents, justifications }: { incidents: StudentIncident[]; justifications: StudentJustification[] }) {
  const orderedIncidents = useMemo(() => [...incidents].sort((a, b) => b.dataOcorrencia.localeCompare(a.dataOcorrencia)), [incidents])
  const orderedJustifications = useMemo(() => [...justifications].sort((a, b) => b.dataJustificativa.localeCompare(a.dataJustificativa)), [justifications])
  return (
    <section className="space-y-5" aria-labelledby="records-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-eyebrow"><FileCheck2 className="size-4" />Informações para você</p>
        <h2 id="records-title" className="type-title mt-2 text-3xl font-extrabold text-heading">Ocorrências e justificativas</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Veja somente registros vinculados ao seu cadastro.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader className="border-b border-border/70 p-5"><CardTitle className="flex items-center gap-2 font-display text-lg font-bold"><HeartPulse className="size-5 text-[#BF7655]" />Ocorrências</CardTitle><CardDescription>Registros escolares sobre você.</CardDescription></CardHeader>
          <CardContent className="p-5">
            {orderedIncidents.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Ainda não há registros nesta seção.</div> : <ul className="space-y-3">
              {orderedIncidents.map((item) => <li key={item.id} className="rounded-2xl bg-[#F8F9F6] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-card text-[#8A7157]"><AlertCircle className="size-4" /></span><h3 className="text-sm font-bold">{item.titulo}</h3></div><Badge variant="outline" className={`rounded-full ${item.resolvida ? 'bg-surface-tint text-on-soft' : 'bg-[#FFF5DB] text-[#896622]'}`}>{item.resolvida ? 'Encerrada' : 'Em acompanhamento'}</Badge></div>
                <p className="mt-3 text-sm leading-6 text-[#5E6B61]">{item.descricao}</p>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{formatDate(item.dataOcorrencia)}{item.severidade ? ` · ${item.severidade}` : ''}</p>
              </li>)}
            </ul>}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader className="border-b border-border/70 p-5"><CardTitle className="flex items-center gap-2 font-display text-lg font-bold"><FileCheck2 className="size-5 text-[#668C5D]" />Justificativas de ausência</CardTitle><CardDescription>Acompanhe a situação e as datas registradas.</CardDescription></CardHeader>
          <CardContent className="p-5">
            {orderedJustifications.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Ainda não há justificativas registradas.</div> : <ul className="divide-y divide-border/70">
              {orderedJustifications.map((item) => <li key={item.id} className="py-4 first:pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{formatDate(item.data_falta)}</p><Badge variant="outline" className={`rounded-full ${justificationCopy[item.status].className}`}>{justificationCopy[item.status].label}</Badge></div>
                <p className="mt-2 text-xs font-semibold text-[#506257]">{item.motivo.replaceAll('_', ' ')}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.descricao}</p>
                {item.status === 'rejeitada' && item.motivoRejeicao && <p className="mt-3 rounded-lg bg-[#FFF0E9] px-3 py-2 text-xs leading-5 text-[#8F5035]">Motivo informado: {item.motivoRejeicao}</p>}
                {item.status === 'aprovada' && <p className="mt-3 flex items-center gap-1.5 text-xs text-on-soft"><CheckCircle2 className="size-3.5" />Justificativa aprovada</p>}
              </li>)}
            </ul>}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
