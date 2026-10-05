import { useMemo, useState } from 'react'
import { Activity, BookOpenCheck, CalendarDays, ChevronDown, MessageSquareText, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { StudentAssessment } from '@/lib/types'
import { formatBimester, formatDate } from '@/lib/formatters'

const criteria = [
  ['fundamentos', 'Fundamentos'],
  ['condicionamento_fisico', 'Condicionamento físico'],
  ['disciplina', 'Disciplina'],
  ['trabalho_em_equipe', 'Trabalho em equipe'],
  ['assiduidade', 'Assiduidade'],
] as const

function score(value: number) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
}

export function AssessmentSection({ assessments }: { assessments: StudentAssessment[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const periods = useMemo(() => [...assessments].sort((a, b) => b.bimestre.localeCompare(a.bimestre)), [assessments])
  const active = periods.find((item) => item.bimestre === selectedId) ?? periods[0]

  return (
    <section className="space-y-5" aria-labelledby="assessments-heading">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#66806D]"><BookOpenCheck className="size-4" />Seu desenvolvimento</p>
          <h2 id="assessments-heading" className="type-title mt-2 text-3xl font-extrabold text-[#18372F]">Avaliações</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Acompanhe cada critério e leia os comentários do professor. Sua avaliação é sobre o seu percurso.</p>
        </div>
        {periods.length > 0 && (
          <Select items={periods.map((period) => ({ value: period.bimestre, label: formatBimester(period.bimestre) }))} value={active?.bimestre} onValueChange={(value) => setSelectedId(typeof value === 'string' ? value : null)}>
            <SelectTrigger className="h-11 w-full rounded-xl bg-white sm:w-64" aria-label="Selecionar bimestre">
              <SelectValue placeholder="Escolha um bimestre" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((period) => <SelectItem key={period.id} value={period.bimestre}>{formatBimester(period.bimestre)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {active ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <Card className="overflow-hidden border-0 shadow-none ring-1 ring-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border/70 bg-white p-5 sm:p-6">
              <div>
                <CardTitle className="font-display text-xl font-bold">{formatBimester(active.bimestre)}</CardTitle>
                <CardDescription className="mt-1 flex items-center gap-1.5"><CalendarDays className="size-3.5" />Registrada em {formatDate(active.dataAtualizacao ?? active.dataAvaliacao)}</CardDescription>
              </div>
              <div className="rounded-2xl bg-[#EAF0E5] px-4 py-3 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#607666]">Média</p>
                <p className="font-display text-2xl font-extrabold text-[#234E40]">{score(active.media)}<span className="text-xs font-semibold text-[#718078]">/10</span></p>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                <span>Critério</span><span>Escala de 0 a 10</span>
              </div>
              <div className="space-y-5">
                {criteria.map(([key, label]) => {
                  const value = active.criterios[key]
                  const percent = Math.max(0, Math.min(value * 10, 100))
                  return (
                    <div key={key} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(170px,0.7fr)_minmax(100px,1fr)_52px]">
                      <span className="text-sm font-semibold text-[#41574A]">{label}</span>
                      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-[#EDF1E9] sm:col-span-1" role="img" aria-label={`${label}: ${score(value)} de 10`}>
                        <div className="h-full rounded-full bg-gradient-to-r from-[#8DAA70] to-[#3F7750] transition-[width] duration-500" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-right font-display text-sm font-extrabold tabular-nums text-[#315A3D]">{score(value)}<span className="font-normal text-muted-foreground">/10</span></span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-5 text-xs text-muted-foreground">A média é calculada a partir dos cinco critérios avaliados.</p>
            </CardContent>
          </Card>

          <Card className="border-0 bg-[#FFFDF7] shadow-none ring-1 ring-[#E9E1CC]">
            <CardHeader className="p-5 pb-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#F6EBCF] text-[#8D6B28]"><MessageSquareText aria-hidden="true" className="size-5" /></div>
              <CardTitle className="mt-3 font-display text-lg font-bold">Uma mensagem do professor</CardTitle>
              <CardDescription>Sobre {formatBimester(active.bimestre).toLocaleLowerCase('pt-BR')}</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <Separator className="mb-4" />
              {active.observacoes ? <p className="text-sm leading-7 text-[#485A4F]">{active.observacoes}</p> : <p className="text-sm leading-6 text-muted-foreground">O professor não deixou observações neste bimestre.</p>}
              <div className="mt-5 flex flex-wrap items-center gap-2"><Badge variant="secondary" className="gap-1 rounded-full bg-[#EAF0E5] text-[#48614C]"><Activity className="size-3" />5 critérios</Badge><Badge variant="outline" className="gap-1 rounded-full border-[#E7DDC4] bg-white text-[#78643E]"><Sparkles className="size-3" />Seu percurso</Badge></div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-dashed bg-white/70 shadow-none ring-1 ring-border">
          <CardContent className="flex flex-col items-center px-5 py-14 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><BookOpenCheck aria-hidden="true" className="size-6" /></div>
            <h3 className="mt-4 font-display text-lg font-bold">Ainda não há avaliação neste bimestre</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Quando o professor registrar sua avaliação, os cinco critérios e os comentários aparecerão aqui.</p>
          </CardContent>
        </Card>
      )}

      {periods.length > 1 && (
        <details className="group rounded-2xl border border-border bg-white px-5 py-4 open:pb-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold marker:hidden">
            <span className="flex items-center gap-2 text-sm"><CalendarDays className="size-4 text-[#668C5D]" />Histórico por bimestre <span className="text-xs font-normal text-muted-foreground">({periods.length})</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 divide-y divide-border/70 border-t border-border/70">
            {periods.map((period) => <button key={period.id} type="button" onClick={() => { setSelectedId(period.bimestre); document.getElementById('assessments-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="font-medium">{formatBimester(period.bimestre)}</span><span className="font-bold tabular-nums">{score(period.media)}/10</span>
            </button>)}
          </div>
        </details>
      )}
    </section>
  )
}
