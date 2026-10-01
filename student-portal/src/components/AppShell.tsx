/**
 * Enhanced App shell supporting both teacher and student roles.
 *
 * Layout: mobile-first with bottom tab bar on small screens (< lg) and fixed
 * sidebar from lg up. Header persists user context, notifications, and
 * connection status. Colours follow the sports palette: emerald for progress,
 * amber/coral for alerts, blue for info.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { LogOut, Menu, X, Bell, BellRing } from 'lucide-react'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { Button } from '@/components/ui/button'
import type { ConnectionStatus as ConnectionStatusValue } from '@/lib/types'
import { cn } from 'cn'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 64rem)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(min-width: 64rem)')
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    query.addEventListener('change', onChange)
    setIsDesktop(query.matches)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}

export interface NavItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge?: number
  badgeVariant?: 'emerald' | 'amber' | 'coral' | 'blue'
}

export interface AppShellProps {
  nav: NavItem[]
  active: string
  onNavigate: (id: string) => void
  roleLabel: string
  userName: string
  monogram: string
  onLogout: () => void
  connection?: { status: ConnectionStatusValue; message: string; lastUpdatedAt: string | null }
  children: React.ReactNode
  notificationCount?: number
  onNotificationsClick?: () => void
  isStudent?: boolean
  headerEnd?: React.ReactNode
}

const BADGE_VARIANTS = {
  emerald: 'bg-emerald-500 text-white',
  amber: 'bg-amber-500 text-white',
  coral: 'bg-coral-500 text-white',
  blue: 'bg-blue-500 text-white',
} as const

const SIDEBAR_BADGE_VARIANTS = {
  emerald: 'bg-emerald-500/20 text-emerald-500',
  amber: 'bg-amber-500/20 text-amber-500',
  coral: 'bg-coral-500/20 text-coral-500',
  blue: 'bg-blue-500/20 text-blue-500',
} as const

export function AppShell({
  nav,
  active,
  onNavigate,
  roleLabel,
  userName,
  monogram,
  onLogout,
  connection,
  children,
  notificationCount = 0,
  onNotificationsClick,
  headerEnd,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const sidebarRef = useRef<HTMLDivElement>(null)
  const notificationButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMenuOpen(false) }, [active])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  useEffect(() => {
    if (!notificationMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationMenuOpen(false)
        notificationButtonRef.current?.focus()
      }
    }
    const onClickOutside = (event: MouseEvent) => {
      if (notificationButtonRef.current && !notificationButtonRef.current.contains(event.target as Node)) {
        setNotificationMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClickOutside)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClickOutside)
    }
  }, [notificationMenuOpen])

  useEffect(() => {
    if (menuOpen) {
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.[0]?.focus()
    }
  }, [menuOpen])

  const handleNavClick = (id: string) => {
    onNavigate(id)
    if (!isDesktop) setMenuOpen(false)
  }

  const renderNavItem = (item: NavItem, isActive: boolean, isMobile: boolean) => {
    const Icon = item.icon
    const badgeVariant = item.badgeVariant || 'coral'

    if (isMobile) {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => handleNavClick(item.id)}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors',
            isActive ? 'text-emerald-600' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
          <span className="truncate px-1">{item.label}</span>
          {item.badge ? (
            <span
              className={cn(
                'absolute right-[22%] top-1.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
                BADGE_VARIANTS[badgeVariant],
              )}
              aria-label={`${item.badge} notificações em ${item.label}`}
            >
              {item.badge > 9 ? '9+' : item.badge}
            </span>
          ) : null}
        </button>
      )
    }

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavClick(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors',
          isActive
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <Icon className={cn('size-[18px] shrink-0', isActive ? 'text-emerald-600' : 'text-sidebar-foreground/70')} aria-hidden="true" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge ? (
          <span
            className={cn(
              'flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
              SIDEBAR_BADGE_VARIANTS[badgeVariant],
            )}
            aria-label={`${item.badge} itens pendentes em ${item.label}`}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        ref={sidebarRef}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Navegação principal"
        role="navigation"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-extrabold text-white"
              aria-hidden="true"
            >
              GE
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[13px] font-extrabold tracking-wide text-emerald-700 dark:text-emerald-300">
                GESTÃO ESPORTIVA
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">{roleLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="-mr-1 rounded-lg p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Menu de navegação">
          {nav.map((item) => {
            const isActive = item.id === active
            return renderNavItem(item, isActive, false)
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs font-bold"
              aria-hidden="true"
            >
              {monogram}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">{roleLabel}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-emerald-600"
            onClick={onLogout}
          >
            <LogOut className="size-4" />
            Sair
          </Button>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <div className="lg:pl-[280px]">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="-ml-1 rounded-lg p-2 text-foreground hover:bg-muted lg:hidden"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              aria-controls="sidebar"
            >
              <Menu className="size-5" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {roleLabel}
              </p>
              <h1 className="truncate font-display text-base font-extrabold text-foreground sm:text-lg">
                {userName}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              {headerEnd}

              {connection && (
                <ConnectionStatus
                  status={connection.status}
                  message={connection.message}
                  lastUpdatedAt={connection.lastUpdatedAt}
                />
              )}

              {onNotificationsClick && (
                <div className="relative">
                  <button
                    ref={notificationButtonRef}
                    type="button"
                    onClick={() => setNotificationMenuOpen(!notificationMenuOpen)}
                    className="relative rounded-lg p-2 text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                    aria-label={notificationCount > 0 ? `${notificationCount} notificações não lidas` : 'Notificações'}
                    aria-expanded={notificationMenuOpen}
                    aria-haspopup="dialog"
                  >
                    {notificationCount > 0 ? (
                      <BellRing className="size-5 text-amber-500" aria-hidden="true" />
                    ) : (
                      <Bell className="size-5" aria-hidden="true" />
                    )}
                    {notificationCount > 0 && (
                      <span
                        className="absolute -right-1 -top-1 flex min-w-4 h-4 items-center justify-center rounded-full bg-coral-500 px-1 text-[10px] font-bold text-white"
                        aria-hidden="true"
                      >
                        {notificationCount > 9 ? '9+' : notificationCount}
                      </span>
                    )}
                  </button>

                  {notificationMenuOpen && (
                    <div
                      className="absolute right-0 mt-2 w-80 origin-top-right rounded-xl border border-border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150"
                      role="dialog"
                      aria-label="Notificações"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-foreground">Notificações</h3>
                        {notificationCount > 0 && (
                          <button
                            type="button"
                            className="text-xs text-emerald-600 hover:underline"
                            onClick={() => {
                              setNotificationMenuOpen(false)
                            }}
                          >
                            Marcar todas como lidas
                          </button>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {notificationCount === 0 ? (
                          <p className="text-center text-muted-foreground py-8 text-sm">
                            Nenhuma notificação nova
                          </p>
                        ) : (
                          <ul className="space-y-2" role="list">
                            {Array.from({ length: Math.min(notificationCount, 5) }, (_, i) => (
                              <li key={i} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted transition-colors">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  <Bell className="size-4" aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">Notificação {i + 1}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    Descrição da notificação para o usuário
                                  </p>
                                </div>
                                <span className="text-[10px] text-muted-foreground shrink-0">Agora</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {notificationCount > 5 && (
                        <button
                          type="button"
                          className="mt-3 w-full text-center text-sm text-emerald-600 hover:underline"
                        >
                          Ver todas as {notificationCount} notificações
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 pb-24 pt-5 sm:px-6 lg:pb-10" id="main-content" role="main">
          {children}
        </main>
      </div>

      {!isDesktop && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
          aria-label="Navegação rápida"
          role="navigation"
        >
          {nav.slice(0, 4).map((item) => {
            const isActive = item.id === active
            return renderNavItem(item, isActive, true)
          })}
        </nav>
      )}
    </div>
  )
}



