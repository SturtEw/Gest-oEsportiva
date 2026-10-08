/**
 * ThemeProvider + ThemeToggle — modo escuro por CLASSE (Tailwind v4 dark mode).
 *
 * A variante `dark:` deste projeto aponta para `.dark` no <html> (ver
 * @custom-variant em index.css). Este provider:
 *  - aplica/remove a classe no <html> e persiste em localStorage ('theme');
 *  - na primeira visita segue o sistema (prefers-color-scheme);
 *  - sincroniza entre abas e atualiza o theme-color meta.
 * O script inline no index.html aplica o tema salvo ANTES do primeiro paint
 * (anti-flash); este provider assume a partir daí.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'

const THEME_KEY = 'theme'

function initialTheme(): Theme {
  // Espelha o script inline do index.html (anti-flash).
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => undefined })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
    // Cores de fundo do browser UI (barra de endereço mobile).
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#0B1220' : '#153B34')
  }, [theme])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) setTheme(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => setTheme((current) => (current === 'dark' ? 'light' : 'dark')), [])
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/** Toggle animado (sol/lua) para o header. Sol de dia, lua à noite, transição suave. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      className="relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border border-border bg-secondary transition-colors duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:bg-slate-800"
    >
      <span
        className={
          'absolute flex size-7 items-center justify-center rounded-full bg-white text-amber-500 shadow-md transition-all duration-300 ease-in-out dark:bg-slate-900 dark:text-sky-300 ' +
          (isDark ? 'translate-x-8' : 'translate-x-1')
        }
      >
        {isDark ? <Moon aria-hidden="true" className="size-4" /> : <Sun aria-hidden="true" className="size-4" />}
      </span>
      <span className={'pointer-events-none absolute text-[10px] font-bold ' + (isDark ? 'left-2 text-muted-foreground' : 'right-2 text-muted-foreground')}>
        {isDark ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}
