import { Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from 'cn'
import type { ForumClassSummary } from '@/lib/types'

interface Props {
  classes: ForumClassSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  /** Sidebar (desktop) ou seletor horizontal (mobile). */
  layout: 'sidebar' | 'inline'
}

/** Seletor de turma do fórum: menu lateral ou lista horizontal no topo. */
export function ClassSelector({ classes, activeId, onSelect, layout }: Props) {
  if (classes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Você não participa de nenhuma turma com fórum ainda.
      </div>
    )
  }

  if (layout === 'inline') {
    return (
      <div role="tablist" aria-label="Escolher turma do fórum" className="flex gap-2 overflow-x-auto pb-1">
        {classes.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(item.id)}
              className={cn(
                'shrink-0 rounded-full border px-4 py-2 text-sm transition',
                active ? 'border-primary bg-secondary font-semibold' : 'border-border bg-card hover:bg-muted',
              )}
            >
              {item.nome}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <nav aria-label="Turmas do fórum" className="space-y-1">
      {classes.map((item) => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'w-full rounded-xl px-3 py-2.5 text-left transition',
              active ? 'bg-surface-soft ring-1 ring-[#C7D8BF]' : 'hover:bg-muted',
            )}
          >
            <p className={cn('truncate text-sm', active ? 'font-bold text-primary' : 'font-semibold')}>{item.nome}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <Users aria-hidden="true" className="size-3" />
              {item.total_membros} membro(s){item.modalidade ? ` · ${item.modalidade}` : ''}
            </p>
          </button>
        )
      })}
    </nav>
  )
}

export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null
  return <Badge className="rounded-full">{count}</Badge>
}
