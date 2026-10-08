/**
 * StudentCheckIn — área do aluno: subgrupos (aulas) da turma, com
 * "Entrar na Aula" / "Sair da Aula" e cronômetro enquanto estiver em aula.
 *
 * Realtime: a seção "subgroups" chega pelo WebSocket; o hook refetcha e o
 * cronômetro é recalculado a partir da `entrada` gravada pelo servidor
 * (o relógio do dispositivo do aluno nunca é fonte de verdade — ele só
 * anima a contagem entre refetches).
 */

import { CircleAlert, LogIn, LogOut, Timer, Users } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useElapsedTimer } from '@/hooks/useElapsedTimer'
import { usePollingRevision } from '@/hooks/usePollingRevision'
import { useStudentSubgroups } from '@/hooks/useStudentSubgroups'
import type { StudentSubgroup } from '@/lib/api/subgroups'

interface Props {
  alunoId: string
  revision: number
  /** Realtime is pushing changes; otherwise fetch by polling. */
  live: boolean
  /** Only the student themself checks in; guardians and "view as" read. */
  canCheckIn: boolean
}

export function StudentCheckIn({ alunoId, revision, live, canCheckIn }: Props) {
  const tick = usePollingRevision(!live)
  const { subgroups, loading, error, checkin, checkout, reload } = useStudentSubgroups(alunoId, revision + tick)

  return (
    <section className="space-y-5" aria-labelledby="checkin-heading">
      <PageHeading
        id="checkin-heading"
        icon={Timer}
        eyebrow="Sua turma"
        title="Aulas e presença"
        description="Entre na aula do subgrupo para registrar sua presença. O tempo de permanência é contado pelo servidor."
      />

      {loading && subgroups.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div>
      ) : error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {error}
            <Button variant="outline" size="sm" onClick={reload}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      ) : subgroups.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Seu professor ainda não criou aulas (subgrupos) nesta turma.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {subgroups.map((subgroup) => (
            <StudentSubgroupCard key={subgroup.id} subgroup={subgroup} canCheckIn={canCheckIn} onCheckIn={checkin} onCheckOut={checkout} />
          ))}
        </div>
      )}
    </section>
  )
}

interface CardProps {
  subgroup: StudentSubgroup
  canCheckIn: boolean
  onCheckIn: (id: string) => Promise<void>
  onCheckOut: (id: string) => Promise<void>
}

/**
 * Componente folha: só ele re-renderiza no tick de 1s — o card inteiro não.
 * (Auditoria M4: um setInterval por card multiplicava re-renders do portal.)
 */
function Elapsed({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTimer(startedAt)
  return <span className="tabular-nums">{elapsed}</span>
}

function StudentSubgroupCard({ subgroup, canCheckIn, onCheckIn, onCheckOut }: CardProps) {
  const inClass = Boolean(subgroup.minha_sessao)

  const handleToggle = async () => {
    if (inClass) await onCheckOut(subgroup.id)
    else await onCheckIn(subgroup.id)
  }

  return (
    <Card className={inClass ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20' : undefined}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{subgroup.nome}</h3>
            {subgroup.descricao && <p className="text-sm text-muted-foreground">{subgroup.descricao}</p>}
          </div>
          <Badge variant={inClass ? 'default' : 'secondary'} className="shrink-0">
            <Users aria-hidden="true" className="size-3" />
            {subgroup.ativos} {subgroup.ativos === 1 ? 'em aula' : 'em aula'}
          </Badge>
        </div>

        {inClass ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
            <Timer aria-hidden="true" className="size-4" />
            <span>Você está em aula — <Elapsed startedAt={subgroup.minha_sessao!.entrada} /></span>
          </div>
        ) : null}

        {canCheckIn && (
          <Button
            className="w-full"
            variant={inClass ? 'outline' : 'default'}
            onClick={handleToggle}
          >
            {inClass ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {inClass ? 'Sair da Aula' : 'Entrar na Aula'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
