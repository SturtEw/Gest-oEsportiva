/**
 * MyClassesSection — multi-turmas no portal do aluno.
 *
 * Mostra TODAS as turmas do aluno (turmas_ids), marca a principal (turma_id) e
 * permite sair de uma turma sem afetar as demais. Abaixo do gerenciamento,
 * reutiliza a EnrollmentHome (busca + convite + status) para o aluno solicitar
 * OUTRAS turmas mesmo já estando vinculado — o que antes era bloqueado.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, LogOut, School, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { StudentClassDetailed } from '@/lib/types'
import { EnrollmentHome } from '@/features/enrollment/EnrollmentHome'

interface Props {
  alunoId: string
  revision: number
  readOnly?: boolean
  onChanged: () => void
}

export function MyClassesSection({ alunoId, revision, readOnly, onChanged }: Props) {
  const [turmas, setTurmas] = useState<StudentClassDetailed[]>([])
  const [principalId, setPrincipalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.studentClasses(alunoId)
      setTurmas(data.turmas)
      setPrincipalId(data.turma_id)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas turmas.')
    } finally {
      setLoading(false)
    }
  }, [alunoId])

  useEffect(() => { void load() }, [load, revision])

  const leave = async (turma: StudentClassDetailed) => {
    if (readOnly || busyId) return
    setBusyId(turma.id)
    try {
      const result = await api.leaveClass(turma.id)
      toast.success(
        result.turmas_restantes.length > 0
          ? `Você saiu da turma ${turma.nome}. Suas outras turmas seguem ativas.`
          : `Você saiu da turma ${turma.nome}. Agora você pode procurar outra turma.`,
      )
      setConfirmId(null)
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sair da turma.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-8" aria-labelledby="my-classes-heading">
      <div>
        <h2 id="my-classes-heading" className="type-title text-2xl font-extrabold text-heading">Minhas turmas</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Você pode participar de mais de uma turma ao mesmo tempo. Peça entrada em outras ou saia quando quiser.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div>
      ) : turmas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Você ainda não participa de nenhuma turma. Use a busca abaixo para encontrar uma.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {turmas.map((turma) => {
            const principal = turma.id === principalId
            const confirming = confirmId === turma.id
            return (
              <Card key={turma.id} className="rounded-2xl border-border shadow-lg shadow-slate-200/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-card dark:shadow-black/30">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 font-display text-base font-bold text-heading">
                      <School aria-hidden="true" className="size-4 text-primary dark:text-emerald-400" />
                      {turma.nome}
                    </CardTitle>
                    {principal && <Badge className="shrink-0 rounded-full"><Check aria-hidden="true" className="size-3" /> Principal</Badge>}
                  </div>
                  <CardDescription className="text-xs">
                    {turma.modalidade ?? 'Turma'}{turma.professor_nome ? ` · ${turma.professor_nome}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {confirming ? (
                    <div className="space-y-2 rounded-xl bg-notice p-3">
                      <p className="text-xs font-medium text-notice-foreground">Sair de {turma.nome}? Suas outras turmas não são afetadas.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" className="rounded-lg" disabled={busyId === turma.id} onClick={() => void leave(turma)}>
                          {busyId === turma.id ? 'Saindo…' : 'Confirmar saída'}
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setConfirmId(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                      disabled={readOnly}
                      onClick={() => setConfirmId(turma.id)}
                    >
                      <LogOut aria-hidden="true" /> Sair da turma
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Busca/solicitação de outras turmas — disponível mesmo já tendo turma. */}
      <EnrollmentHome revision={revision} onJoined={onChanged} readOnly={readOnly} adding={turmas.length > 0} />
    </section>
  )
}
