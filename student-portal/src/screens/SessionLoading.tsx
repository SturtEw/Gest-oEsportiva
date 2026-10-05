import { RefreshCw } from 'lucide-react'

/**
 * "Verificando sua sessão…" — shown while /api/auth/me answers and while a lazy
 * screen chunk downloads. Tailwind only: it is part of the initial bundle, which
 * no longer carries Bootstrap.
 */
export function SessionLoading({ label = 'Verificando sua sessão…' }: { label?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background" aria-busy="true">
      <p role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
        {label}
      </p>
    </main>
  )
}
