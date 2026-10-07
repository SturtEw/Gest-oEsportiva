import { BookOpen, CalendarDays, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SearchInput, matchesQuery } from '@/components/SearchInput'
import { api } from '@/lib/api'
import type { StudentClass, StudentClassDetailed } from '@/lib/types'

interface Props {
  turma: StudentClass | null
  professorNome: string | null
  alunoId?: string
}

/**
 * "Minha turma" com suporte a multi-turmas: lista todas as turmas do aluno
 * (endpoint /api/student/me/classes) e mantém o fallback legado (snapshot.turma)
 * enquanto o novo campo não estiver disponível.
 */
export function ClassSummary({ turma, professorNome, alunoId }: Props) {
  const [all, setAll] = useState<StudentClassDetailed[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!alunoId) return
    let active = true
    api.myClasses(alunoId)
      .then((result) => { if (active) setAll(result.turmas) })
      .catch(() => undefined) // fallback silencioso para o snapshot legado
    return () => { active = false }
  }, [alunoId])

  const classes = useMemo(
    () => (all ?? (turma ? [{ ...turma, professor_id: null, professor_nome: professorNome }] : []))
      .filter((item) => matchesQuery(item.nome, query) || matchesQuery(item.modalidade, query)),
    [all, turma, professorNome, query],
  )

  const multiple = classes.length > 1
  return (
    <section className="space-y-5" aria-labelledby="class-title">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#66806D]"><UsersRound className="size-4" />Sua atividade esportiva</p>
        <h2 id="class-title" className="type-title mt-2 text-3xl font-extrabold text-[#18372F]">{multiple ? 'Minhas turmas' : 'Minha turma'}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Informações da sua matrícula, sem exibir dados pessoais de outros alunos.</p>
      </div>
      {classes.length === 0 ? (
        <Card className="border-dashed bg-white/70 shadow-none ring-1 ring-border">
          <CardHeader><CardTitle className="font-display">Nenhuma turma vinculada</CardTitle><CardDescription>Quando a escola registrar sua matrícula, as informações aparecerão aqui.</CardDescription></CardHeader>
          <CardContent className="pb-6 text-sm text-muted-foreground">Ainda não há dados de turma para esta conta.</CardContent>
        </Card>
      ) : (
        <>
          {multiple && <SearchInput value={query} onChange={setQuery} placeholder="Buscar turma ou modalidade…" label="Filtrar turmas" />}
          <div className="grid gap-4 xl:grid-cols-2">
            {classes.map((item) => (
              <Card key={item.id} className="overflow-hidden border-0 shadow-none ring-1 ring-border">
                <div className="p-6 sm:p-8">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-[#EAF0E5] text-[#55734D]"><BookOpen aria-hidden="true" className="size-6" /></div>
                  <p className="mt-6 text-xs font-bold uppercase tracking-[0.12em] text-[#66806D]">{multiple ? 'Turma' : 'Sua turma'}</p>
                  <h3 className="type-title mt-1 text-2xl font-extrabold text-[#18372F]">{item.nome}</h3>
                  <p className="mt-2 text-base text-muted-foreground">{item.modalidade}</p>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <div className="rounded-xl bg-[#F7F9F5] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Ano</p><p className="mt-1 font-semibold">{item.ano}</p></div>
                    <div className="rounded-xl bg-[#F7F9F5] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Modalidade</p><p className="mt-1 font-semibold">{item.modalidade}</p></div>
                  </div>
                </div>
                <aside className="border-t border-border/70 bg-[#F7F9F5] p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-white text-[#55734D]"><UserRound aria-hidden="true" className="size-5" /></div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Professor vinculado</p>
                      <p className="truncate font-display text-sm font-bold">{item.professor_nome ?? 'Não informado'}</p>
                    </div>
                  </div>
                  <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" />Não há horários de aula futuros cadastrados.</p>
                </aside>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
