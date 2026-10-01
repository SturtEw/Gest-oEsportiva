import { ArrowRight, Bell, BookOpenCheck, CalendarCheck2, MessageCircle } from 'lucide-react'
import type { PortalSection, StudentPortalSnapshot } from '@/lib/types'
import { formatBimester, formatDate, formatDateTime, toSortableTime } from '@/lib/formatters'

interface FeedEvent {
  id: string
  date: string
  /** Numeric timestamp used for ordering — string compare is not chronological. */
  time: number
  title: string
  detail: string
  section: PortalSection
  icon: typeof CalendarCheck2
}

export function RecentRecordsFeed({ snapshot, onOpenSection }: { snapshot: StudentPortalSnapshot; onOpenSection: (section: PortalSection) => void }) {
  const events: FeedEvent[] = [
    ...snapshot.presencas.slice(0, 3).map((record): FeedEvent => {
      // A chamada has no own instant; fall back to the class day so the feed still
      // has something comparable to sort on.
      const date = record.dataRegistro ?? `${record.data_aula}T12:00:00Z`
      return {
        id: `attendance-${record.chamada_id}`,
        date,
        time: toSortableTime(date),
        title: record.status ? `Chamada atualizada: ${record.status === 'presente' ? 'Presente' : record.status === 'ausente' ? 'Ausente' : 'Justificada'}` : 'Chamada sem registro informado',
        detail: formatDate(record.data_aula),
        section: 'presencas',
        icon: CalendarCheck2,
      }
    }),
    ...snapshot.avaliacoes.slice(0, 3).map((record): FeedEvent => {
      const date = record.dataAtualizacao ?? record.dataAvaliacao
      return {
        id: `assessment-${record.id}`,
        date,
        time: toSortableTime(date),
        title: `Avaliação registrada · ${formatBimester(record.bimestre)}`,
        detail: `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(record.media)}/10`,
        section: 'avaliacoes',
        icon: BookOpenCheck,
      }
    }),
    ...snapshot.comunicados.slice(0, 3).map((record): FeedEvent => ({
      id: `announcement-${record.id}`,
      date: record.dataEnvio,
      time: toSortableTime(record.dataEnvio),
      title: record.titulo,
      detail: record.urgente ? 'Comunicado importante' : `Por ${record.autor_nome}`,
      section: 'comunicados',
      icon: Bell,
    })),
  ]

  const recent = events.sort((a, b) => b.time - a.time).slice(0, 5)

  return (
    <div className="divide-y divide-border/70">
      {recent.length === 0 ? <div className="py-9 text-center"><div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><MessageCircle className="size-5" /></div><p className="mt-3 font-semibold">Seu percurso começa aqui</p><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Quando a escola registrar uma chamada, avaliação ou comunicado, você verá as novidades nesta área.</p></div> : recent.map((event) => {
        const Icon = event.icon
        return <button key={event.id} type="button" onClick={() => onOpenSection(event.section)} className="flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-[#FBFCF9] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F2F5EF] text-[#55734D]"><Icon aria-hidden="true" className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{event.title}</span><span className="mt-1 block text-xs text-muted-foreground">{event.detail} · {formatDateTime(event.date)}</span></span>
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      })}
    </div>
  )
}
