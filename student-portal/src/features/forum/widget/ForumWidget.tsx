/**
 * ForumWidget — FAB arrastável + janela flutuante do fórum.
 *
 * Arraste vs. clique: o FAB usa eventos nativos de pointer (mouse/touch
 * unificados); o toggle só dispara se o gesto mover menos de 6px (clique).
 * Fecha com Esc. Reaproveita `api.forumClasses` e o ChatRoom existente —
 * o delta fetch (`useForum`) e o WebSocket de invalidações seguem iguais.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Maximize2, MessageCircle, MessagesSquare, Minimize2, Search, Sparkles, X } from 'lucide-react'
import { ChatRoom } from '@/features/forum/ChatRoom'
import { AiChatRoom } from './AiChatRoom'
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

/** Posição inicial do FAB: canto inferior direito. */
function initialPoint(): Point {
  return clampToViewport(window.innerWidth - FAB_SIZE - 24, window.innerHeight - FAB_SIZE - 24)
}

/** Limita a janela flutuante à viewport (tamanho fixo WINDOW_W x WINDOW_H). */
function clampWindow(x: number, y: number): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - WINDOW_W - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - WINDOW_H - MARGIN)
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  }
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
  onSelectAi,
  onClose,
}: {
  classes: ForumClassSummary[]
  loading: boolean
  error: string | null
  onSelect: (classId: string, name: string, subgroupId: string | null, subgroupName: string | null) => void
  onSelectAi: () => void
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
            className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-[#234E40] focus:ring-2 focus:ring-[#234E40]/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-surface-soft-2 p-2">
        {/* Canal fixo da IA — sempre no topo, destacado das turmas. */}
        <button
          type="button"
          onClick={onSelectAi}
          className="group/ai mb-2 flex w-full items-center gap-2.5 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-purple-50 to-violet-100 px-3 py-2.5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-violet-800/60 dark:from-violet-950/60 dark:via-purple-950/50 dark:to-violet-900/40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md transition-transform duration-300 group-hover/ai:scale-110">
            <Bot aria-hidden="true" className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate text-sm font-bold text-violet-900 dark:text-violet-100">
              Tira-Dúvidas <Sparkles aria-hidden="true" className="size-3.5 text-violet-500 dark:text-violet-300" />
            </span>
            <span className="block truncate text-xs text-violet-700/80 dark:text-violet-300/80">Assistente Virtual · conversa privada</span>
          </span>
        </button>

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
                      className="min-w-0 flex-1 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-surface-soft"
                    >
                      <span className="block truncate text-sm font-semibold text-heading">{item.nome}</span>
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
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-soft"
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
                            className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-[#3A5548] transition hover:bg-surface-soft"
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
  // Canal privado com a IA (View 2 alternativa, sem turma associada).
  const [aiOpen, setAiOpen] = useState(false)
  // Janela: posição atual e modo tela cheia.
  const [win, setWin] = useState<Point>(() => clampWindow(window.innerWidth - WINDOW_W - MARGIN, window.innerHeight - WINDOW_H - MARGIN))
  const [fullscreen, setFullscreen] = useState(false)
  const winDrag = useRef({ active: false, pointerId: -1, startPointer: { x: 0, y: 0 } as Point, startPos: { x: 0, y: 0 } as Point })
  // Referência do <section> raiz: a captura de pointer fica nele (e não no
  // header), para o arrasto sobreviver ao cursor saindo do header.
  const windowRef = useRef<HTMLElement | null>(null)

  const startWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (fullscreen || (event.pointerType === 'mouse' && event.button !== 0)) return
    // Não arrastar quando o gesto começa num controle interativo do header.
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, a')) return
    winDrag.current = {
      active: true,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPos: win,
    }
    // Capture no elemento raiz da janela: o gesto continua mesmo saindo do header.
    windowRef.current?.setPointerCapture(event.pointerId)
  }

  const moveWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
    const state = winDrag.current
    if (!state.active || event.pointerId !== state.pointerId) return
    setWin(clampWindow(state.startPos.x + (event.clientX - state.startPointer.x), state.startPos.y + (event.clientY - state.startPointer.y)))
  }

  const endWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
    const state = winDrag.current
    if (!state.active || event.pointerId !== state.pointerId) return
    state.active = false
    windowRef.current?.releasePointerCapture?.(event.pointerId)
  }

  const toggleFullscreen = useCallback(() => {
    setFullscreen((value) => {
      // Ao sair da tela cheia, garante que a janela volte para dentro da viewport.
      if (value) setWin((current) => clampWindow(current.x, current.y))
      return !value
    })
  }, [])

  useEffect(() => {
    let active = true
    api.forumClasses()
      .then((result) => { if (active) { setClasses(result.classes); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas turmas.') })
      .finally(() => { if (active) setLoading(false) })
    // revision sobe a cada invalidação "forum" — a lista acompanha turmas e
    // subgrupos criados em tempo real, como as demais seções do portal.
    return () => { active = false }
  }, [revision])

  // Fecha com Esc; ao redimensionar/rotacionar, re-clampa a janela e o FAB.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onResize = () => setWin((current) => clampWindow(current.x, current.y))
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const close = useCallback(() => { setOpen(false); setSelected(null); setAiOpen(false) }, [])

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
          ref={windowRef}
          role="dialog"
          aria-label="Fórum da turma"
          className={"fixed z-[9999] flex flex-col overflow-hidden bg-card shadow-2xl ring-1 ring-black/10 " + (fullscreen ? "" : "rounded-2xl")}
          style={fullscreen
            ? { left: 0, top: 0, width: "100%", height: "100%" }
            : { left: win.x, top: win.y, width: WINDOW_W, height: WINDOW_H }}
        >
          {aiOpen ? (
            /* View 2 (IA): chat privado com o Assistente Virtual. */
            <div className="flex h-full min-h-0 flex-col">
              <header
                onPointerDown={startWindowDrag}
                onPointerMove={moveWindowDrag}
                onPointerUp={endWindowDrag}
                onPointerCancel={endWindowDrag}
                className={"flex touch-none select-none items-center gap-2 border-b border-violet-900/30 bg-gradient-to-r from-violet-600 to-purple-700 px-3 py-2.5 text-white " + (fullscreen ? "" : "cursor-move")}
              >
                {!fullscreen && (
                  <button type="button" aria-label="Voltar para a lista" onClick={() => setAiOpen(false)} className="rounded-full p-1.5 transition hover:bg-white/15">
                    <ArrowLeft className="size-5" />
                  </button>
                )}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                  <Bot aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-bold">Assistente Virtual</h2>
                  <p className="text-xs text-white/75">Tira-dúvidas · conversa privada</p>
                </div>
                <button
                  type="button"
                  aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  onClick={toggleFullscreen}
                  className="rounded-full p-1.5 transition hover:bg-white/15"
                >
                  {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
                </button>
                <button type="button" aria-label="Fechar fórum" onClick={close} className="rounded-full p-1.5 transition hover:bg-white/15">
                  <X className="size-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1">
                <AiChatRoom myUserId={myUserId} revision={revision} />
              </div>
            </div>
          ) : selected && chatTarget ? (
            <div className="flex h-full min-h-0 flex-col">
              <header
                onPointerDown={startWindowDrag}
                onPointerMove={moveWindowDrag}
                onPointerUp={endWindowDrag}
                onPointerCancel={endWindowDrag}
                className={"flex touch-none select-none items-center gap-2 border-b border-border/70 bg-[#234E40] px-3 py-2.5 text-white " + (fullscreen ? "" : "cursor-move")}
              >
                {!fullscreen && (
                  <button type="button" aria-label="Voltar para a lista de turmas" onClick={() => setSelected(null)} className="rounded-full p-1.5 transition hover:bg-white/15">
                    <ArrowLeft className="size-5" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-bold">{chatTarget.turmaNome}</h2>
                  {chatTarget.totalMembros != null && (
                    <p className="text-xs text-white/70">{chatTarget.totalMembros} membros</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  onClick={toggleFullscreen}
                  className="rounded-full p-1.5 transition hover:bg-white/15"
                >
                  {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
                </button>
                <button type="button" aria-label="Fechar fórum" onClick={close} className="rounded-full p-1.5 transition hover:bg-white/15">
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
                  layout="fill"
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header
                onPointerDown={startWindowDrag}
                onPointerMove={moveWindowDrag}
                onPointerUp={endWindowDrag}
                onPointerCancel={endWindowDrag}
                className={"flex touch-none select-none items-center justify-between gap-2 border-b border-border/70 bg-[#234E40] px-4 py-3 text-white " + (fullscreen ? "" : "cursor-move")}
              >
                <div className="flex items-center gap-2">
                  <MessagesSquare className="size-5" />
                  <h2 className="font-display text-base font-bold">Fórum</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Tela cheia" onClick={toggleFullscreen} className="rounded-full p-1.5 transition hover:bg-white/15">
                    <Maximize2 className="size-5" />
                  </button>
                  <button type="button" aria-label="Fechar fórum" onClick={close} className="rounded-full p-1.5 transition hover:bg-white/15">
                    <X className="size-5" />
                  </button>
                </div>
              </header>
              <div className="min-h-0 flex-1">
                <ClassList
                  classes={classes}
                  loading={loading}
                  error={error}
                  onSelect={(classId, name, subgroupId, subgroupName) => setSelected({ classId, name, subgroupId, subgroupName })}
                  onSelectAi={() => { setSelected(null); setAiOpen(true) }}
                  onClose={close}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
