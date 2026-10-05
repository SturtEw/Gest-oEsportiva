import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, Flag, Hand, Lock, Trophy, Users } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAction } from '@/hooks/useAction'
import { usePollingRevision } from '@/hooks/usePollingRevision'
import { useStudentActivities } from '@/hooks/useStudentActivities'
import { FORMAT_LABELS } from '@/lib/bracket'
import type { StudentActivity } from '@/lib/types'
import { ActivityMeta } from '../ActivityMeta'
import { BracketView } from '../bracket/BracketView'

interface Props {
  alunoId: string
  revision: number
  /** Realtime is pushing changes; otherwise scores and teams are fetched by polling. */
  live: boolean
  /** Only the student themself marks interest; guardians and "view as" read. */
  canJoin: boolean
}

export function StudentActivitiesSection({ alunoId, revision, live, canJoin }: Props) {
  const tick = usePollingRevision(!live)
  const { activities, loading, error, join, leave, reload } = useStudentActivities(alunoId, revision + tick)

  return (
    <section className="space-y-5" aria-labelledby="activities-heading">
      <PageHeading
        id="activities-heading"
        icon={Flag}
        eyebrow="Sua turma"
        title="Atividades da turma"
        description={canJoin
          ? 'Torneios, gincanas e eventos que o professor organizou. Marque "Tenho interesse" para participar.'
          : 'Torneios, gincanas e eventos da turma, e em quais o aluno está inscrito.'}
      />

      {loading && activities.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
      ) : error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {error}
            <Button variant="outline" size="sm" onClick={reload}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      ) : activities.length === 0 ? (
        <Card className="border-dashed shadow-none ring-1 ring-border">
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><Flag aria-hidden="true" className="size-6" /></span>
            <p className="mt-4 font-display font-bold">Nenhuma atividade por enquanto</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Quando o professor criar um torneio ou evento para a turma, ele aparece aqui.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="m-0! list-none space-y-4 p-0!">
          {activities.map((activity) => (
            <li key={activity.id}>
              <ActivityCard activity={activity} canJoin={canJoin} onJoin={() => join(activity.id)} onLeave={() => leave(activity.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface CardProps {
  activity: StudentActivity
  canJoin: boolean
  onJoin: () => Promise<unknown>
  onLeave: () => Promise<unknown>
}

function ActivityCard({ activity, canJoin, onJoin, onLeave }: CardProps) {
  const bracket = activity.chaveamento
  const myTeam = bracket?.times.find((team) => team.meu_time) ?? null
  // Open by default when the student plays in it: their matches are what matters.
  const [showBracket, setShowBracket] = useState(Boolean(myTeam))
  const { busy, error, run } = useAction('Não foi possível atualizar sua inscrição.')
  const soldOut = activity.vagas_restantes === 0
  const canMarkInterest = activity.inscricoes_abertas && !soldOut

  return (
    <Card className="border-0 shadow-none ring-1 ring-border">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {activity.inscrito && <Badge className="rounded-full bg-sidebar-primary text-sidebar-primary-foreground"><Check aria-hidden="true" />Inscrito</Badge>}
              {bracket && <Badge variant="secondary" className="rounded-full"><Trophy aria-hidden="true" />{FORMAT_LABELS[bracket.formato]}</Badge>}
              {!activity.inscrito && !activity.inscricoes_abertas && <Badge variant="outline" className="rounded-full text-muted-foreground"><Lock aria-hidden="true" />Inscrições encerradas</Badge>}
              {!activity.inscrito && activity.inscricoes_abertas && soldOut && <Badge variant="outline" className="rounded-full text-muted-foreground">Vagas esgotadas</Badge>}
            </div>
            <h3 className="font-display text-lg font-extrabold leading-snug text-heading">{activity.titulo}</h3>
            <ActivityMeta activity={activity} />
          </div>

          {canJoin && (
            <div className="shrink-0">
              {activity.inscrito ? (
                activity.pode_sair ? (
                  <Button variant="outline" className="w-full rounded-xl sm:w-auto" disabled={busy} onClick={() => void run(onLeave)}>
                    {busy ? 'Saindo…' : 'Desistir'}
                  </Button>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground sm:max-w-[12rem] sm:text-right">Times sorteados. Para sair, fale com o professor.</p>
                )
              ) : canMarkInterest ? (
                <Button className="w-full rounded-xl sm:w-auto" disabled={busy} onClick={() => void run(onJoin)}>
                  <Hand aria-hidden="true" />
                  {busy ? 'Enviando…' : 'Tenho interesse'}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {activity.descricao && <p className="whitespace-pre-line text-sm leading-6 text-foreground/85">{activity.descricao}</p>}
        {activity.inscrito && activity.origem === 'professor' && !bracket && (
          <p className="text-xs text-muted-foreground">O professor incluiu você nesta atividade.</p>
        )}

        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {myTeam && (
          <div className="flex items-start gap-3 rounded-xl bg-accent/40 px-4 py-3">
            <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-heading" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-heading">Seu time: {myTeam.nome}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{(myTeam.membros ?? []).map((member) => member.nome).join(', ')}</p>
            </div>
          </div>
        )}

        {bracket && (
          <div className="space-y-4 border-t border-border/70 pt-4">
            <Button variant="ghost" size="sm" className="-ml-2 rounded-lg" aria-expanded={showBracket} onClick={() => setShowBracket((open) => !open)}>
              <ChevronDown aria-hidden="true" className={showBracket ? 'rotate-180 transition-transform' : 'transition-transform'} />
              {showBracket ? 'Esconder chaveamento' : 'Ver chaveamento e placares'}
            </Button>
            {showBracket && <BracketView bracket={bracket} highlightTeamId={myTeam?.id} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
