import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Shown in the message, e.g. "Treinamentos e chaves". */
  label?: string
  /** "app" wraps the whole portal: last line of defence against a blank page. */
  scope?: 'section' | 'app'
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
    if (this.props.scope === 'app') {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
          <Alert variant="destructive" role="alert" className="max-w-md bg-card">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Algo deu errado ao exibir o portal.</AlertTitle>
            <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <span>Seus dados estão seguros. Recarregue a página para continuar.</span>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Recarregar</Button>
            </AlertDescription>
          </Alert>
        </main>
      )
    }
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Não foi possível exibir {this.props.label ? `“${this.props.label}”` : 'esta seção'}.</AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span>As outras áreas do portal continuam disponíveis.</span>
          <Button variant="outline" size="sm" onClick={this.reset}>Tentar novamente</Button>
        </AlertDescription>
      </Alert>
    )
  }
}
