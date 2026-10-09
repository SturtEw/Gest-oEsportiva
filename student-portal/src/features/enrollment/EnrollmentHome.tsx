import { useEffect, useRef } from 'react'
import { Compass } from 'lucide-react'
import { toast } from 'sonner'
import { useStudentEnrollment } from '@/hooks/useStudentEnrollment'
import type { JoinedClass } from '@/lib/types'
import { ClassSearchList } from './ClassSearchList'
import { InviteCodeForm } from './InviteCodeForm'
import { JoinRequestStatusCard } from './JoinRequestStatusCard'

interface Props {
  /** Realtime invalidation counter from the student area. */
  revision: number
  /** Called once the student is in a class, so the portal reloads into the class view. */
  onJoined: () => void
  /** Admin "view as": consultation only, no requests or codes. */
  readOnly?: boolean
  /** Quando true, o cabeçalho fala de ADICIONAR turma (aluno já matriculado). */
  adding?: boolean
}

/**
 * Home screen for a student account without a class. Two ways in:
 *   code from the teacher → direct entry; or
 *   search → join request → teacher approval (status shown here).
 */
export function EnrollmentHome({ revision, onJoined, readOnly, adding }: Props) {
  const enrollment = useStudentEnrollment({ enabled: true, revision })
  const announcedRef = useRef<string | null>(null)
  const onJoinedRef = useRef(onJoined)
  onJoinedRef.current = onJoined

  // Approval arrives through realtime: the status reports a class, so switch the
  // portal over to it (once, even under StrictMode's double effects).
  const joinedClassId = enrollment.status?.turma_id ?? null
  useEffect(() => {
    if (!joinedClassId || announcedRef.current === joinedClassId) return
    announcedRef.current = joinedClassId
    const approved = enrollment.status?.requests.find((item) => item.turma_id === joinedClassId && item.status === 'aprovada')
    if (approved) toast.success(`Pedido aprovado! Agora você faz parte da turma ${approved.turma_nome}.`)
    onJoinedRef.current()
  }, [joinedClassId, enrollment.status])

  const handleJoined = (turma: JoinedClass) => {
    announcedRef.current = turma.id
    toast.success(`Você entrou na turma ${turma.nome}.`)
    onJoinedRef.current()
  }

  return (
    <section className="space-y-6" aria-labelledby="enrollment-title">
      <header>
        <p className="eyebrow flex items-center gap-2"><Compass aria-hidden="true" className="size-4" />{adding ? 'Mais turmas' : 'Primeiros passos'}</p>
        <h2 id="enrollment-title" className="type-title mt-2 text-3xl font-extrabold text-heading">
          {adding ? 'Encontre outra turma' : 'Encontre sua turma'}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {adding
            ? 'Você pode participar de mais de uma turma. Recebeu um código? Entre direto. Se não, procure a turma e peça para participar.'
            : 'Recebeu um código do professor? Use-o para entrar direto. Se não, procure a turma e peça para participar — o professor responde por aqui.'}
        </p>
      </header>

      {readOnly && (
        <p className="rounded-xl bg-notice p-4 text-sm text-notice-foreground">
          Visualização de consulta: pedidos e códigos ficam desativados.
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <aside className="space-y-5 lg:order-last" aria-label="Código de convite e pedidos">
          <InviteCodeForm onJoin={enrollment.joinWithCode} onJoined={handleJoined} disabled={readOnly} />
          <JoinRequestStatusCard
            requests={enrollment.status?.requests ?? []}
            loading={enrollment.statusLoading}
            error={enrollment.statusError}
            onCancel={async (id) => {
              await enrollment.cancelRequest(id)
              toast('Pedido cancelado. Você já pode escolher outra turma.')
            }}
            readOnly={readOnly}
          />
        </aside>

        <ClassSearchList
          query={enrollment.query}
          onQueryChange={enrollment.setQuery}
          classes={enrollment.classes}
          loading={enrollment.classesLoading}
          error={enrollment.classesError}
          onRetry={enrollment.reload}
          pendingRequest={enrollment.pendingRequest}
          onRequest={enrollment.requestToJoin}
          onRequested={(created) => toast.success(`Pedido enviado para ${created.turma_nome}. Avisaremos quando o professor responder.`)}
          readOnly={readOnly}
        />
      </div>
    </section>
  )
}
