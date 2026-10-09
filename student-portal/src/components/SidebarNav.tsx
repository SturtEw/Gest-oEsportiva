/**
 * SidebarNav — navegação lateral com categorias expansíveis (Progressive
 * Disclosure). Compartilhada pela área do aluno (aside desktop + drawer mobile)
 * e reaproveita a mesma linguagem visual do AppShell.
 *
 * Regras:
 * - O grupo que contém a rota ativa abre automaticamente.
 * - Chevron aponta para baixo quando fechado e gira 180° quando aberto.
 * - O item ativo recebe fundo de destaque sólido; nenhuma rota é removida.
 */

import { useEffect, useState, type ComponentType } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'

export interface StudentNavItem {
  id: string
  label: string
  short?: string
  icon: ComponentType<{ className?: string }>
}

export interface StudentNavGroup {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  items: StudentNavItem[]
}

interface Props {
  groups: StudentNavGroup[]
  active: string
  onNavigate: (id: string) => void
  onPrefetch?: (id: string) => void
  /** 'sidebar' = trilho vertical (desktop/drawer); 'grid' = grade do menu mobile. */
  layout: 'sidebar' | 'grid'
  /** Rota que representa a "home": navega e fecha o drawer. */
  onAfterNavigate?: () => void
}

export function SidebarNav({ groups, active, onNavigate, onPrefetch, layout, onAfterNavigate }: Props) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // Abre o grupo do item ativo — o usuário sempre vê onde está.
  useEffect(() => {
    const owner = groups.find((group) => group.items.some((item) => item.id === active))
    if (owner) setOpenGroups((current) => (current[owner.id] ? current : { ...current, [owner.id]: true }))
  }, [active, groups])

  const toggle = (id: string) => setOpenGroups((current) => ({ ...current, [id]: !current[id] }))

  const navigate = (id: string) => {
    onNavigate(id)
    onAfterNavigate?.()
  }

  if (layout === 'grid') {
    // Mobile: cada grupo é uma seção empilhada, com os itens em grade de 2 colunas.
    return (
      <div className="space-y-2">
        {groups.map((group) => {
          const Icon = group.icon
          const isOpen = Boolean(openGroups[group.id])
          const hasActive = group.items.some((item) => item.id === active)
          return (
            <div key={group.id} className="rounded-xl border border-border/70">
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={isOpen}
                aria-controls={`mnav-group-${group.id}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-in-out',
                  hasActive && !isOpen ? 'text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex-1 truncate">{group.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn('size-4 shrink-0 transition-transform duration-300 ease-in-out', isOpen && 'rotate-180')}
                />
              </button>
              <div
                id={`mnav-group-${group.id}`}
                className={cn('grid transition-all duration-300 ease-in-out', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
              >
                <div className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon
                      const isActive = item.id === active
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => navigate(item.id)}
                          onPointerDown={() => onPrefetch?.(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-all duration-300 ease-in-out',
                            isActive ? 'bg-secondary font-semibold text-primary' : 'text-foreground/75 hover:bg-muted',
                          )}
                        >
                          <ItemIcon aria-hidden="true" className="size-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const Icon = group.icon
        const isOpen = Boolean(openGroups[group.id])
        const hasActive = group.items.some((item) => item.id === active)
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={isOpen}
              aria-controls={`snav-group-${group.id}`}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-in-out',
                hasActive && !isOpen
                  ? 'text-sidebar-primary'
                  : 'text-white/50 hover:bg-white/10 hover:text-white/80',
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1 truncate">{group.label}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 shrink-0 transition-transform duration-300 ease-in-out', isOpen && 'rotate-180')}
              />
            </button>

            <div
              id={`snav-group-${group.id}`}
              className={cn('grid transition-all duration-300 ease-in-out', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
            >
              <div className="overflow-hidden">
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/15 pl-2">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon
                    const isActive = item.id === active
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(item.id)}
                        onPointerEnter={() => onPrefetch?.(item.id)}
                        onFocus={() => onPrefetch?.(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group/item flex w-full items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-2 text-left text-[13px] transition-all duration-300 ease-in-out',
                          isActive
                            ? 'bg-accent-soft font-bold text-on-accent-soft shadow-sm'
                            : 'text-white/70 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'h-4 w-0.5 shrink-0 rounded-full transition-colors duration-300',
                            isActive ? 'bg-on-accent-soft/60' : 'bg-white/20 group-hover/item:bg-white/45',
                          )}
                        />
                        <ItemIcon aria-hidden="true" className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
