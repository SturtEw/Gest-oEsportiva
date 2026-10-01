import { useMemo } from 'react'
import { Bell, Megaphone, Pin, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentAnnouncement } from '@/lib/types'
import { formatDateTime, toSortableTime } from '@/lib/formatters'

export function AnnouncementsSection({ announcements }: { announcements: StudentAnnouncement[] }) {
  const ordered = useMemo(() => [...announcements].sort((a, b) => toSortableTime(b.dataEnvio) - toSortableTime(a.dataEnvio)), [announcements])
  return (
    <section className="space-y-5" aria-labelledby="announcements-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#66806D]"><Megaphone className="size-4" />Da sua turma</p>
        <h2 id="announcements-title" className="type-title mt-2 text-3xl font-extrabold text-[#18372F]">Comunicados</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Recados enviados à sua turma, do mais recente para o mais antigo.</p>
      </div>
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader className="border-b border-border/70 p-5 sm:p-6"><CardTitle className="flex items-center gap-2 font-display text-xl font-bold"><Bell className="size-5 text-[#668C5D]" />Mural da turma</CardTitle><CardDescription>{ordered.length} comunicados disponíveis</CardDescription></CardHeader>
        <CardContent className="p-5 sm:p-6">
          {ordered.length === 0 ? <div className="px-3 py-12 text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><Megaphone className="size-5" /></div><p className="mt-4 font-semibold">Ainda não há comunicados</p><p className="mt-1 text-sm text-muted-foreground">Os recados enviados à sua turma aparecerão aqui.</p></div> : <ul className="space-y-4">
            {ordered.map((item) => <li key={item.id} className="rounded-2xl border border-border/80 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#EAF0E5] text-[#55734D]"><Megaphone className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-bold">{item.titulo}</h3>{item.urgente && <Badge variant="destructive" className="rounded-full"><Pin className="size-3" />Importante</Badge>}</div><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Send className="size-3" />{item.autor_nome} · {formatDateTime(item.dataEnvio)}</p></div></div></div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#4E6054]">{item.mensagem}</p>
            </li>)}
          </ul>}
        </CardContent>
      </Card>
    </section>
  )
}
