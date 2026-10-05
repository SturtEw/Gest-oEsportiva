import { useState } from 'react'
import { CircleAlert, Flag, Lock, Plus, Trophy } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePollingRevision } from '@/hooks/usePollingRevision'
import { useTeacherActivities } from '@/hooks/useTeacherActivities'
import { FORMAT_LABELS } from '@/lib/bracket'
import type { ActivitySummary } from '@/lib/types'
import { cn } from 'cn'
import { ActivityMeta } from '../ActivityMeta'
import { ActivityDetail } from './ActivityDetail'
import { ActivityFormDialog } from './ActivityFormDialog'

interface Props {
  revision: number
  /** Realtime is pushing changes; otherwise new interests are fetched by polling. */
  live: boolean
  readOnly: boolean
  onNotice: (message: string) => void
}

/** Teacher's "Atividades" page: the list on the left, the open activity on the right. */
export function TeacherActivitiesView({ revision, live, readOnly, onNotice }: Props) {
  const tick = usePollingRevision(!live)
  const state = useTeacherActivities({ revision: revision + tick })
  const [creating, setCreating] = useState(false)
  const { classes, activities, selectedId, detail } = state

  if (state.loading && activities.length === 0 && classes.length === 0) {
    return (
      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="hidden h-96 rounded-2xl lg:block" />
      </div>
    )
  }
  if (state.error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    )
  }
  if (classes.length === 0) {
    return (
      <Card className="border-dashed ring-1 ring-border">
        <CardContent className="p-10 text-center">
          <Flag aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 font-display font-bold">Nenhuma turma vinculada</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">As atividades pertencem a uma turma. Assim que a administração vincular uma turma a você, crie a primeira.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className={cn('space-y-3 lg:sticky lg:top-24', selectedId && 'hidden lg:block')} aria-label="Lista de atividades">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-muted-foreground">
            {activities.length === 0 ? 'Nenhuma atividade' : activities.length === 1 ? '1 atividade' : `${activities.length} atividades`}
          </p>
          {!readOnly && (
            <Button size="sm" className="rounded-lg" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Nova atividade
            </Button>
          )}
        </div>
        {activities.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
            <p className="text-sm font-semibold">Comece pela primeira</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Um torneio relâmpago, uma gincana, um amistoso. Crie quantas quiser.</p>
          </div>
        ) : (
          <ul className="m-0! list-none space-y-2 p-0!">
            {activities.map((activity) => (
              <li key={activity.id}>
                <ActivityListItem activity={activity} selected={activity.id === selectedId} onSelect={() => state.select(activity.id)} />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className={cn('min-w-0', !selectedId && 'hidden lg:block')}>
        {!selectedId ? (
          <Card className="border-dashed shadow-none ring-1 ring-border">
            <CardContent className="flex flex-col items-center px-6 py-16 text-center">
              <Trophy aria-hidden="true" className="size-8 text-muted-foreground" />
              <p className="mt-3 font-display font-bold">Escolha uma atividade</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">Veja quem se inscreveu, monte os times e registre os placares.</p>
            </CardContent>
          </Card>
        ) : state.detailError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              {state.detailError}
              <Button variant="outline" size="sm" onClick={() => state.select(null)}>Voltar</Button>
            </AlertDescription>
          </Alert>
        ) : !detail || detail.id !== selectedId ? (
          <div className="space-y-4"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
        ) : (
          <ActivityDetail detail={detail} state={state} readOnly={readOnly} onBack={() => state.select(null)} onNotice={onNotice} />
        )}
      </div>

      <ActivityFormDialog
        open={creating}
        onOpenChange={setCreating}
        classes={classes}
        onSubmit={async (input) => { const created = await state.create(input); onNotice(`Atividade "${created.titulo}" criada. Os alunos da turma já podem vê-la.`) }}
      />
    </div>
  )
}

function ActivityListItem({ activity, selected, onSelect }: { activity: ActivitySummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'w-full rounded-2xl bg-card p-4 text-left ring-1 ring-border transition-shadow outline-none hover:ring-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50',
        selected && 'ring-2 ring-primary',
      )}
    >
      <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{activity.turma_nome ?? 'Turma'}</p>
      <p className="mt-1 line-clamp-2 font-display text-[15px] font-bold leading-snug text-heading">{activity.titulo}</p>
      <ActivityMeta activity={activity} className="mt-2" />
      {(activity.formato || !activity.inscricoes_abertas) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {activity.formato && <Badge variant="secondary" className="rounded-full"><Trophy aria-hidden="true" />{FORMAT_LABELS[activity.formato]}</Badge>}
          {!activity.inscricoes_abertas && <Badge variant="outline" className="rounded-full text-muted-foreground"><Lock aria-hidden="true" />Inscrições fechadas</Badge>}
        </div>
      )}
    </button>
  )
}
