import { useState } from 'react'
import { ArrowLeft, CircleAlert, Pencil, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAction } from '@/hooks/useAction'
import type { TeacherActivitiesState } from '@/hooks/useTeacherActivities'
import type { TeacherActivityDetail } from '@/lib/types'
import { ActivityMeta } from '../ActivityMeta'
import { ActivityFormDialog } from './ActivityFormDialog'
import { BracketCard } from './BracketCard'
import { ParticipantsCard } from './ParticipantsCard'

interface Props {
  detail: TeacherActivityDetail
  state: TeacherActivitiesState
  readOnly: boolean
  onBack: () => void
  onNotice: (message: string) => void
}

/** One activity: its details, the participants and the bracket. */
export function ActivityDetail({ detail, state, readOnly, onBack, onNotice }: Props) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const toggle = useAction('Não foi possível mudar as inscrições.')

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 rounded-lg lg:hidden" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        Todas as atividades
      </Button>

      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">{[detail.turma_nome, detail.modalidade].filter(Boolean).join(' · ') || 'Turma'}</p>
              <h2 className="mt-1.5 font-display text-xl font-extrabold leading-tight text-heading sm:text-2xl">{detail.titulo}</h2>
            </div>
            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Editar</Button>
                <Button variant="ghost" size="icon-sm" aria-label="Excluir atividade" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" /></Button>
              </div>
            )}
          </div>
          <ActivityMeta activity={detail} />
          {detail.descricao && <p className="whitespace-pre-line text-sm leading-6 text-foreground/85">{detail.descricao}</p>}

          <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3">
            <div className="min-w-0">
              <label htmlFor="activity-open-toggle" className="text-sm font-semibold">Inscrições abertas</label>
              <p className="text-xs leading-5 text-muted-foreground">
                {detail.inscricoes_abertas ? 'Os alunos da turma podem marcar "Tenho interesse".' : 'Só você adiciona participantes.'}
              </p>
            </div>
            <Switch
              id="activity-open-toggle"
              checked={detail.inscricoes_abertas}
              disabled={readOnly || toggle.busy}
              onCheckedChange={(checked) => void toggle.run(() => state.update({ inscricoes_abertas: checked }))}
            />
          </div>
          {toggle.error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{toggle.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <ParticipantsCard detail={detail} readOnly={readOnly} onAdd={state.addParticipants} onRemove={state.removeParticipant} />

      <BracketCard
        detail={detail}
        readOnly={readOnly}
        onCreate={state.createBracket}
        onDelete={state.deleteBracket}
        onSaveTeams={state.saveTeams}
        onRedraw={state.redrawTeams}
        onRecordResult={state.recordResult}
      />

      <ActivityFormDialog
        open={editing}
        onOpenChange={setEditing}
        classes={state.classes}
        activity={detail}
        onSubmit={({ turma_id: _turma, ...changes }) => state.update(changes)}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir esta atividade?"
        description={`"${detail.titulo}" some para os alunos, junto com participantes, times e placares.`}
        confirmLabel="Excluir atividade"
        destructive
        onConfirm={async () => { await state.remove(); onNotice(`Atividade "${detail.titulo}" excluída.`) }}
      />
    </div>
  )
}
