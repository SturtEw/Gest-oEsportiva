import { ArrowRight, Award, BookOpenCheck, CalendarCheck2, ChevronRight, MessageCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RecentRecordsFeed } from '@/features/home/RecentRecordsFeed'
import type { PortalSection, StudentPortalSnapshot } from '@/lib/types'
import { formatBimester, formatDate, toSortableTime } from '@/lib/formatters'

const heroImage = 'https://images.pexels.com/photos/8927011/pexels-photo-8927011.jpeg'

export function HomeDashboard({ snapshot, onOpenSection }: { snapshot: StudentPortalSnapshot; onOpenSection: (section: PortalSection) => void }) {
  const latestAssessment = [...snapshot.avaliacoes].sort((a, b) => toSortableTime(b.dataAtualizacao ?? b.dataAvaliacao) - toSortableTime(a.dataAtualizacao ?? a.dataAvaliacao))[0]
  const presentCount = snapshot.presencas.filter((item) => item.status === 'presente').length
  const attendanceCount = snapshot.presencas.filter((item) => item.status !== null).length
  const latestAnnouncement = [...snapshot.comunicados].sort((a, b) => toSortableTime(b.dataEnvio) - toSortableTime(a.dataEnvio))[0]

  return (
    <section className="space-y-6" aria-labelledby="home-title">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
        <article className="relative min-h-[265px] overflow-hidden rounded-[1.65rem] bg-[#153B34] shadow-[0_14px_35px_rgba(21,59,52,0.12)] sm:min-h-[320px]">
          <img
            src={heroImage}
            alt="Estudantes praticam esporte ao ar livre — foto de Thirdman no Pexels"
            width={1200}
            height={675}
            loading="lazy"
            className="absolute inset-0 size-full object-cover opacity-60"
            style={{ width: '100%', height: '100%' }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#153B34]/95 via-[#153B34]/65 to-[#153B34]/15" aria-hidden="true" />
          <div className="relative z-10 flex min-h-[265px] max-w-xl flex-col justify-end p-6 text-white sm:min-h-[320px] sm:p-8">
            <Badge variant="outline" className="mb-4 w-fit gap-1.5 rounded-full border-white/25 bg-white/10 text-white"><Sparkles className="size-3.5" />Sua área esportiva</Badge>
            <p className="text-sm font-semibold text-[#D9EFAB]">Bom te ver por aqui!</p>
            <h1 id="home-title" className="type-title mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">Seu percurso, no seu ritmo.</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/80">Acompanhe o que a escola registrou e pergunte ao professor quando precisar.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button type="button" onClick={() => onOpenSection('avaliacoes')} className="h-11 rounded-xl bg-[#D9EFAB] px-4 font-bold text-[#183C32] hover:bg-[#C7E78A]">Ver avaliações<ArrowRight aria-hidden="true" /></Button>
              <Button type="button" variant="outline" onClick={() => onOpenSection('duvidas')} className="h-11 rounded-xl border-white/30 bg-white/10 px-4 text-white hover:bg-white/20 hover:text-white"><MessageCircle aria-hidden="true" />Perguntar ao professor</Button>
            </div>
          </div>
        </article>

        <Card className="border-0 shadow-none ring-1 ring-border">
          {/* CardHeader is a grid: the button needs CardAction to sit beside the
              title (flex-row had no effect and dropped it under the description). */}
          <CardHeader className="border-b border-border/70 p-5">
            <CardTitle className="font-display text-lg font-bold">O que mudou</CardTitle>
            <CardDescription className="mt-1">Atualizações reais da escola</CardDescription>
            <CardAction><Button type="button" variant="ghost" size="icon" aria-label="Ver comunicados" onClick={() => onOpenSection('comunicados')}><ChevronRight aria-hidden="true" /></Button></CardAction>
          </CardHeader>
          <CardContent className="px-5">
            <RecentRecordsFeed snapshot={snapshot} onOpenSection={onOpenSection} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-0 bg-white shadow-none ring-1 ring-border">
            <CardContent className="flex h-full flex-col p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#EAF0E5] text-[#55734D]"><CalendarCheck2 aria-hidden="true" className="size-5" /></span>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Presenças registradas</p>
              <p className="mt-1 font-display text-2xl font-extrabold">{attendanceCount ? `${presentCount} de ${attendanceCount}` : '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{attendanceCount ? 'chamadas informadas' : 'Ainda sem chamadas'}</p>
              <Button type="button" variant="link" className="mt-auto justify-start px-0 pt-4 text-sm font-bold" onClick={() => onOpenSection('presencas')}>Ver presenças<ArrowRight aria-hidden="true" /></Button>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white shadow-none ring-1 ring-border">
            <CardContent className="flex h-full flex-col p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#FFF5DB] text-[#956A20]"><Award aria-hidden="true" className="size-5" /></span>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Conquistas pessoais</p>
              <p className="mt-1 font-display text-2xl font-extrabold">{snapshot.conquistas.length || '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.conquistas.length ? 'registradas pelo professor' : 'Aguardando registros'}</p>
              <Button type="button" variant="link" className="mt-auto justify-start px-0 pt-4 text-sm font-bold" onClick={() => onOpenSection('conquistas')}>Ver conquistas<ArrowRight aria-hidden="true" /></Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 bg-[#EAF0E5] shadow-none ring-0">
          <CardHeader className="flex-row items-start justify-between gap-4 p-5 pb-3">
            <div><CardTitle className="flex items-center gap-2 font-display text-lg font-bold text-[#234E40]"><BookOpenCheck aria-hidden="true" className="size-5" />Um passo de cada vez</CardTitle><CardDescription className="mt-1 text-[#5E7463]">Seu registro mais recente</CardDescription></div>
            {latestAssessment && <Badge variant="outline" className="shrink-0 rounded-full border-[#C7D8BF] bg-white/70 text-[#426848]">{formatBimester(latestAssessment.bimestre)}</Badge>}
          </CardHeader>
          <CardContent className="p-5 pt-1">
            {latestAssessment ? <>
              <p className="font-display text-2xl font-extrabold text-[#234E40]">Média {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(latestAssessment.media)}<span className="text-sm font-semibold text-[#66806D]">/10</span></p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[#5E7463]">Atualizada em {formatDate(latestAssessment.dataAtualizacao ?? latestAssessment.dataAvaliacao)}</p>
              {latestAssessment.observacoes && <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#475E4E]">“{latestAssessment.observacoes}”</p>}
            </> : <p className="text-sm leading-6 text-[#5E7463]">Quando sua avaliação for registrada, você verá a média, os cinco critérios e a mensagem do professor aqui.</p>}
            {latestAnnouncement && <p className="mt-3 truncate border-t border-[#D3E0CD] pt-3 text-xs text-[#617665]">Comunicado recente: <span className="font-semibold">{latestAnnouncement.titulo}</span></p>}
            <Button type="button" variant="link" className="mt-3 justify-start px-0 text-sm font-bold text-[#315A3D]" onClick={() => onOpenSection('avaliacoes')}>Abrir avaliações<ArrowRight aria-hidden="true" /></Button>
          </CardContent>
        </Card>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#668C5D]" />Informações atualizadas</span><span aria-hidden="true">·</span><span>Últimos dados carregados em {formatDate(snapshot.atualizado_em)}</span><span className="sr-only">Nenhum horário de aula futuro é exibido porque não há agenda cadastrada para esta conta.</span></p>
    </section>
  )
}
