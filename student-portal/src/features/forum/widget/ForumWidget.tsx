/**
 * ForumWidget — FAB arrastável + janela flutuante do fórum.
 *
 * Arraste vs. clique: o FAB usa eventos nativos de pointer (mouse/touch
 * unificados); o toggle só dispara se o gesto mover menos de 6px (clique).
 * Fecha com Esc. Reaproveita `api.forumClasses` e o ChatRoom existente —
 * o delta fetch (`useForum`) e o WebSocket de invalidações seguem iguais.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, MessageCircle, MessagesSquare, Search, X } from 'lucide-react'
import { ChatRoom } from '@/features/forum/ChatRoom'
import { api } from '@/lib/api'
import type { ForumClassSummary } from '@/lib/types'

/* ─── Geometria ─────────────────────────────────────────────────────────── */
const FAB_SIZE = 56
const WINDOW_W = 360
const WINDOW_H = 520
const MARGIN = 16
const DRAG_THRESHOLD = 6

interface Point {
  x: number
  y: number
}

function clampToViewport(x: number, y: number): Point {
  const maxX = window.innerWidth - FAB_SIZE - MARGIN
  const maxY = window.innerHeight - FAB_SIZE - MARGIN
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, maxX)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, maxY)),
  }
}

/** Posição inicial: canto inferior direito. */
function initialPoint(): Point {
  return clampToViewport(window.innerWidth - FAB_SIZE - 24, window.innerHeight - FAB_SIZE - 24)
}

/* ─── FAB arrastável ────────────────────────────────────────────────────── */
function DraggableFab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [pos, setPos] = useState<Point>(initialPoint)
  const drag = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startPointer: { x: 0, y: 0 } as Point,
    startPos: { x: 0, y: 0 } as Point,
  })

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    drag.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPos: pos,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state.active || event.pointerId !== state.pointerId) return
    const dx = event.clientX - state.startPointer.x
    const dy = event.clientY - state.startPointer.y
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.moved = true
    setPos(clampToViewport(state.startPos.x + dx, state.startPos.y + dy))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state.active || event.pointerId !== state.pointerId) return
    state.active = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!state.moved) onToggle()
  }

  return (
    <button
      type="button"
      aria-label={open ? 'Fechar fórum' : 'Abrir fórum'}
      aria-expanded={open}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="fixed z-[9998] flex touch-none select-none items-center justify-center rounded-full shadow-lg ring-1 ring-black/10 transition-transform active:scale-95"
      style={{ left: pos.x, top: pos.y, width: FAB_SIZE, height: FAB_SIZE, backgroundColor: '#234E40' }}
    >
      {open ? <X className="size-6 text-white" /> : <MessageCircle className="size-6 text-white" />}
    </button>
  )
}

/* ─── View 1: lista de turmas + subgrupos ───────────────────────────────── */
function ClassList({
  classes,
  loading,
  error,
  onSelect,
  onClose,
}: {
  classes: ForumClassSummary[]
  loading: boolean
  error: string | null
  onSelect: (classId: string, name: string, subgroupId: string | null, subgroupName: string | null) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return classes
    return classes.filter(
      (item) => item.nome.toLowerCase().includes(q) || (item.modalidade ?? '').toLowerCase().includes(q),
    )
  }, [classes, query])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 bg-[#234E40] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <MessagesSquare className="size-5" />
          <h2 className="font-display text-base font-bold">Fórum</h2>
        </div>
        <button type="button" aria-label="Fechar fórum" onClick={onClose} className="rounded-full p-1.5 transition hover:bg-white/15">
          <X className="size-5" />
        </button>
      </header>

      <div className="border-b border-border/70 p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar turma ou subgrupo…"
            aria-label="Buscar turma ou subgrupo"
            className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-[#234E40] focus:ring-2 focus:ring-[#234E40]/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#FAFCF7] p-2">
        {loading ? (
          <div className="space-y-2 p-1" aria-busy="true">
            <div className="h-14 animate-pulse rounded-xl bg-muted" />
            <div className="h-14 animate-pulse rounded-xl bg-muted" />
            <div className="h-14 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {query ? 'Nada encontrado para essa busca.' : 'Você ainda não participa de nenhuma turma com fórum.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((item) => {
              const subs = item.subgrupos ?? []
              const isOpen = expanded[item.id] ?? false
              return (
                <li key={item.id}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelect(item.id, item.nome, null, null)}
                      className="min-w-0 flex-1 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-[#EAF0E5]"
                    >
                      <span className="block truncate text-sm font-semibold text-[#18372F]">{item.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.modalidade ?? 'Turma'} · {item.total_membros} {item.total_membros === 1 ? 'membro' : 'membros'}
                      </span>
                    </button>
                    {subs.length > 0 && (
                      <button
                        type="button"
                        aria-label={isOpen ? `Ocultar subgrupos de ${item.nome}` : `Ver subgrupos de ${item.nome}`}
                        aria-expanded={isOpen}
                        onClick={() => setExpanded((current) => ({ ...current, [item.id]: !isOpen }))}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-[#EAF0E5]"
                      >
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <ul className="mb-1 ml-4 border-l border-border pl-2">
                      {subs.map((sub) => (
                        <li key={sub.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(item.id, item.nome, sub.id, sub.nome)}
                            className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-[#3A5548] transition hover:bg-[#EAF0E5]"
                          >
                            {sub.nome}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ─── Widget (FAB + janela) ─────────────────────────────────────────────── */
export function ForumWidget({ myUserId, myRole, live, revision }: {
  myUserId: string
  myRole: 'professor' | 'aluno'
  live: boolean
  revision: number
}) {
  const [open, setOpen] = useState(false)
  const [classes, setClasses] = useState<ForumClassSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null = View 1 (lista); preenchido = View 2 (chat da turma/subgrupo).
  const [selected, setSelected] = useState<{ classId: string; name: string; subgroupId: string | null; subgroupName: string | null } | null>(null)

  useEffect(() => {
    let active = true
    api.forumClasses()
      .then((result) => { if (active) { setClasses(result.classes); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas turmas.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  // Fecha com Esc.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const close = useCallback(() => { setOpen(false); setSelected(null) }, [])

  const chatTarget = useMemo(() => {
    if (!selected) return null
    const cls = classes.find((item) => item.id === selected.classId)
    return {
      turmaId: selected.classId,
      turmaNome: selected.subgroupName ? `${selected.name} · ${selected.subgroupName}` : selected.name,
      totalMembros: cls?.total_membros ?? null,
    }
  }, [selected, classes])

  return (
    <>
      <DraggableFab open={open} onToggle={() => setOpen((value) => !value)} />

      {open && (
        <section
          role="dialog"
          aria-label="Fórum da turma"
          className="fixed z-[9999] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
          style={{ right: MARGIN, bottom: MARGIN + FAB_SIZE + 8, width: WINDOW_W, height: WINDOW_H }}
        >
          {selected && chatTarget ? (
            <div className="flex h-full flex-col">
              <header className="flex items-center gap-2 border-b border-border/70 bg-[#234E40] px-3 py-2.5 text-white">
                <button type="button" aria-label="Voltar para a lista de turmas" onClick={() => setSelected(null)} className="rounded-full p-1.5 transition hover:bg-white/15">
                  <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold">{chatTarget.turmaNome}</h2>
                  {chatTarget.totalMembros != null && (
                    <p className="text-xs text-white/70">{chatTarget.totalMembros} membros</p>
                  )}
                </div>
                <button type="button" aria-label="Fechar fórum" onClick={close} className="ml-auto rounded-full p-1.5 transition hover:bg-white/15">
                  <X className="size-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1">
                <ChatRoom
                  turmaId={chatTarget.turmaId}
                  turmaNome={chatTarget.turmaNome}
                  totalMembros={chatTarget.totalMembros}
                  myUserId={myUserId}
                  myRole={myRole}
                  live={live}
                  revision={revision}
                />
              </div>
            </div>
          ) : (
            <ClassList
              classes={classes}
              loading={loading}
              error={error}
              onSelect={(classId, name, subgroupId, subgroupName) => setSelected({ classId, name, subgroupId, subgroupName })}
              onClose={close}
            />
          )}
        </section>
      )}
    </>
  )
}
