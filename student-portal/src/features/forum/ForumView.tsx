/**
 * "Fórum" (Comunidade): chat de grupo por turma, em tempo real.
 *
 * - Aluno vê as turmas em que está matriculado (multi-turmas); professor vê as dele.
 * - Se houver mais de uma turma, o seletor fica em sidebar no desktop e vira
 *   abas horizontais no mobile.
 * - Mensagens chegam sem recarregar: o WebSocket de invalidações (`useRealtimeSync`,
 *   section "forum") bumpa `revision` e o `useForum` busca apenas o delta (`after=`).
 */

import { useEffect, useState } from 'react'
import { CircleAlert, MessagesSquare } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClassSelector } from './ClassSelector'
import { ChatRoom } from './ChatRoom'
import { api } from '@/lib/api'
import type { ForumClassSummary } from '@/lib/types'

interface Props {
  myUserId: string
  myRole: 'professor' | 'aluno'
  live: boolean
  /** Bumped by the realtime invalidation for section "forum". */
  revision: number
}

function Skeleton({ className = 'h-64 rounded-2xl' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-muted ${className}`} aria-hidden="true" />
}

export function ForumView({ myUserId, myRole, live, revision }: Props) {
  const [classes, setClasses] = useState<ForumClassSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.forumClasses()
      .then((result) => {
        if (!active) return
        setClasses(result.classes)
        // Primeira turma aberta por padrão (a lista já vem ordenada por nome).
        setActiveId((current) => current ?? result.classes[0]?.id ?? null)
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas turmas.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const activeClass = classes.find((item) => item.id === activeId) ?? null

  if (loading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Skeleton />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Não foi possível carregar o fórum</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (classes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center p-10 text-center">
          <MessagesSquare aria-hidden="true" className="size-8 text-muted-foreground" />
          <h2 className="mt-4 font-display font-bold">Nenhuma turma com fórum</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Quando você entrar em uma turma, o grupo de conversa dela aparece aqui.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Sidebar (desktop): lista de turmas; mobile: abas horizontais no topo. */}
      <aside className="hidden lg:sticky lg:top-24 lg:block" aria-label="Suas turmas no fórum">
        <Card className="shadow-none ring-1 ring-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Turmas</CardTitle>
            <CardDescription>Um grupo de conversa por turma.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClassSelector layout="sidebar" classes={classes} activeId={activeId} onSelect={setActiveId} />
          </CardContent>
        </Card>
      </aside>

      <div className="space-y-4">
        <div className="lg:hidden">
          <ClassSelector layout="inline" classes={classes} activeId={activeId} onSelect={setActiveId} />
        </div>

        <ChatRoom
          turmaId={activeId}
          turmaNome={activeClass?.nome ?? null}
          totalMembros={activeClass?.total_membros ?? null}
          myUserId={myUserId}
          myRole={myRole}
          live={live}
          revision={revision}
        />
      </div>
    </div>
  )
}
