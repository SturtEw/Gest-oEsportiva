import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Last line of defence against a blank page, around the whole app. Plain markup
 * on purpose: it is in the initial bundle, and the shadcn Alert/Button would
 * pull Base UI and tailwind-merge into it. A chunk that fails to load (deploy
 * with new hashes, connection drop) also lands here, so the action reloads.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app-error]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive">
          <p className="font-semibold">Algo deu errado ao exibir o portal.</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-foreground/80">
            <span>Seus dados estão seguros. Recarregue a página para continuar.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-8 rounded-lg border border-border bg-card px-3 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Recarregar
            </button>
          </div>
        </div>
      </main>
    )
  }
}
