import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Shown in the message, e.g. "Treinamentos e chaves". */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Contains a render error to the current section. Without it React unmounts the
 * whole tree and the portal turns into a blank page (navigation included).
 * Give it `key={sectionId}` so switching sections clears the error.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[section-error]', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    // The whole-app fallback is AppErrorBoundary (no UI-kit imports, initial bundle).
    // A lazy section whose chunk failed to download stays failed (React.lazy caches
    // the rejection), so retrying in place cannot work: offer a reload instead.
    const chunkFailed = /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(this.state.error.message)
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Não foi possível exibir {this.props.label ? `“${this.props.label}”` : 'esta seção'}.</AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span>{chunkFailed ? 'Verifique a conexão e recarregue a página.' : 'As outras áreas do portal continuam disponíveis.'}</span>
          {chunkFailed
            ? <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Recarregar</Button>
            : <Button variant="outline" size="sm" onClick={this.reset}>Tentar novamente</Button>}
        </AlertDescription>
      </Alert>
    )
  }
}
