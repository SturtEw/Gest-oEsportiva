import { BookOpen, CalendarDays, UserRound, UsersRound } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentClass } from '@/lib/types'

export function ClassSummary({ turma, professorNome }: { turma: StudentClass | null; professorNome: string | null }) {
  return (
    <section className="space-y-5" aria-labelledby="class-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#66806D]"><UsersRound className="size-4" />Sua atividade esportiva</p>
        <h2 id="class-title" className="type-title mt-2 text-3xl font-extrabold text-[#18372F]">Minha turma</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Informações da sua matrícula, sem exibir dados pessoais de outros alunos.</p>
      </div>
      {turma ? (
        <Card className="overflow-hidden border-0 shadow-none ring-1 ring-border">
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="p-6 sm:p-8">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><BookOpen aria-hidden="true" className="size-6" /></div>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.12em] text-[#66806D]">Sua turma</p>
              <h3 className="type-title mt-1 text-3xl font-extrabold text-[#18372F]">{turma.nome}</h3>
              <p className="mt-2 text-base text-muted-foreground">{turma.modalidade}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <div className="rounded-xl bg-[#F7F9F5] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Ano</p><p className="mt-1 font-semibold">{turma.ano}</p></div>
                <div className="rounded-xl bg-[#F7F9F5] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Modalidade</p><p className="mt-1 font-semibold">{turma.modalidade}</p></div>
              </div>
            </div>
            <aside className="flex flex-col justify-between gap-7 bg-[#F7F9F5] p-6 sm:p-8">
              <div>
                <div className="flex size-10 items-center justify-center rounded-xl bg-white text-[#55734D]"><UserRound aria-hidden="true" className="size-5" /></div>
                <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Professor vinculado</p>
                <p className="mt-1 font-display text-lg font-bold">{professorNome ?? 'Não informado'}</p>
              </div>
              <div className="border-t border-border/70 pt-4">
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" />Não há horários de aula futuros cadastrados.</p>
              </div>
            </aside>
          </div>
        </Card>
      ) : (
        <Card className="border-dashed bg-white/70 shadow-none ring-1 ring-border">
          <CardHeader><CardTitle className="font-display">Nenhuma turma vinculada</CardTitle><CardDescription>Quando a escola registrar sua matrícula, as informações aparecerão aqui.</CardDescription></CardHeader>
          <CardContent className="pb-6 text-sm text-muted-foreground">Ainda não há dados de turma para esta conta.</CardContent>
        </Card>
      )}
    </section>
  )
}
