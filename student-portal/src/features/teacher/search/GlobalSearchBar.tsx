/**
 * Global search for the teacher area, rendered in the header on every tab.
 * Searches classes, activities and students as you type and shows grouped
 * results; picking one navigates to the right tab (and opens the target).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Flag, Search, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TeacherClass } from '@/lib/types'

export interface SearchTarget {
  kind: 'turma' | 'atividade' | 'aluno'
  id: string
  label: string
  detail?: string
}

interface SearchableActivity { id: string; titulo: string; turma_nome?: string | null }

interface Props {
  classes: TeacherClass[]
  activities: SearchableActivity[]
  students: Array<{ id: string; nome: string; turma_id: string }>
  onPick: (target: SearchTarget) => void
  disabled?: boolean
}

const ICONS: Record<SearchTarget['kind'], LucideIcon> = { turma: BookOpen, atividade: Flag, aluno: Users }
const LABELS: Record<SearchTarget['kind'], string> = { turma: 'Turma', atividade: 'Atividade', aluno: 'Aluno' }

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function GlobalSearchBar({ classes, activities, students, onPick, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const results = useMemo<SearchTarget[]>(() => {
    const term = normalize(query.trim())
    if (term.length < 2) return []
    const match = (value: string | null | undefined) => value != null && normalize(String(value)).includes(term)
    const grouped: SearchTarget[] = [
      ...classes.filter((item) => match(item.nome) || match(item.modalidade))
        .map((item) => ({ kind: 'turma' as const, id: item.id, label: item.nome, detail: [item.modalidade, String(item.ano ?? '')].filter(Boolean).join(' · ') })),
      ...activities.filter((item) => match(item.titulo))
        .map((item) => ({ kind: 'atividade' as const, id: item.id, label: item.titulo, detail: item.turma_nome ?? undefined })),
      ...students.filter((item) => match(item.nome))
        .map((item) => ({ kind: 'aluno' as const, id: item.id, label: item.nome, detail: classes.find((c) => c.id === item.turma_id)?.nome })),
    ]
    return grouped.slice(0, 12)
  }, [query, classes, activities, students])

  // Reset when nothing is typed.
  useEffect(() => { if (!query) setOpen(false) }, [query])

  // Click outside closes.
  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (target: SearchTarget) => {
    onPick(target)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((v) => (v + 1) % results.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((v) => (v - 1 + results.length) % results.length) }
    else if (event.key === 'Enter') { event.preventDefault(); pick(results[highlight]) }
    else if (event.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="teacher-search-results"
          aria-label="Buscar turmas, atividades e alunos"
          value={query}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlight(0) }}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar turmas, atividades, alunos…"
          className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm outline-none transition focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        {query && (
          <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(''); setOpen(false) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div id="teacher-search-results" role="listbox" aria-label="Resultados da busca"
          className="absolute right-0 top-12 z-40 max-h-80 w-full min-w-72 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-xl">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nada encontrado para “{query}”.</p>
          ) : results.map((result, index) => {
            const Icon = ICONS[result.kind]
            return (
              <button key={`${result.kind}-${result.id}`} type="button" role="option" aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(result)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${index === highlight ? 'bg-secondary' : 'hover:bg-muted'}`}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{result.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[LABELS[result.kind], result.detail].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
