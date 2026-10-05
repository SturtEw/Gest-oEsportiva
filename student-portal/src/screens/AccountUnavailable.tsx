import '@/styles/bootstrap-theme.scss'
import { AlertCircle, LogOut, RefreshCw } from 'lucide-react'

export interface AccountUnavailableProps {
  title: string
  message: string
  onLogout: () => void
  onRetry?: () => void
}

/** Account without access to any area (unlinked student, rejected, wrong profile). Bootstrap. */
export function AccountUnavailable({ title, message, onLogout, onRetry }: AccountUnavailableProps) {
  return (
    <main className="d-flex align-items-center justify-content-center bg-body min-vh-100 px-6 py-12">
      <div className="portal-card text-center p-12" style={{ maxWidth: 520 }}>
        <div className="d-flex justify-content-center mb-6">
          <div
            className="d-flex align-items-center justify-content-center rounded-4"
            style={{ width: 56, height: 56, backgroundColor: '#FFF5DB', color: '#896622' }}
          >
            <AlertCircle aria-hidden="true" style={{ width: 24, height: 24 }} />
          </div>
        </div>
        <h1 className="type-title mb-0" style={{ fontSize: 24, fontWeight: 800 }}>
          {title}
        </h1>
        <p className="mt-4 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </p>
        <div className="mt-12 d-flex flex-column flex-sm-row justify-content-center gap-2">
          {onRetry && (
            <button
              type="button"
              className="btn btn-ge-outline d-flex align-items-center justify-content-center gap-2 fw-medium"
              style={{ borderRadius: 16 }}
              onClick={onRetry}
            >
              Tentar novamente
              <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold"
            style={{ borderRadius: 16 }}
            onClick={onLogout}
          >
            Sair da conta
            <LogOut aria-hidden="true" style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </main>
  )
}
