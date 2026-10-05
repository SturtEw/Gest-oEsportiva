import '@/styles/bootstrap-theme.scss'
import { useEffect } from 'react'
import { Clock3, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'

export interface PendingApprovalProps {
  userName: string
  email: string
  refreshSession: () => Promise<void>
  onLogout: () => void
}

/** Teacher account waiting for the root admin's decision; rechecks every 20 s. Bootstrap. */
export function PendingApproval({ userName, email, refreshSession, onLogout }: PendingApprovalProps) {
  useEffect(() => {
    const interval = window.setInterval(() => void refreshSession(), 20000)
    return () => window.clearInterval(interval)
  }, [refreshSession])

  return (
    <main className="bg-body min-vh-100 px-6 py-12">
      <header className="page-container d-flex align-items-center justify-content-between mb-12">
        <div className="d-flex align-items-center gap-4">
          <span
            className="d-flex align-items-center justify-content-center rounded-4 fw-extrabold"
            style={{
              width: 40, height: 40, fontSize: 13, color: '#D9EFAB',
              backgroundColor: '#153B34',
            }}
          >
            GE
          </span>
          <div>
            <p className="mb-0 fw-extrabold text-ge-primary" style={{ fontSize: 12 }}>
              GESTÃO ESPORTIVA ESCOLAR
            </p>
            <p className="mb-0 mt-1 text-ge-muted" style={{ fontSize: 11 }}>
              Área do professor
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ge-outline d-flex align-items-center gap-2 fw-medium"
          style={{ borderRadius: 14 }}
          onClick={onLogout}
        >
          Sair
          <LogOut aria-hidden="true" style={{ width: 16, height: 16 }} />
        </button>
      </header>

      <div className="mx-auto" style={{ maxWidth: 640 }}>
        <div className="portal-card p-6 sm:p-12">
          <div className="d-flex justify-content-center mb-6">
            <div
              className="d-flex align-items-center justify-content-center rounded-4"
              style={{ width: 56, height: 56, backgroundColor: '#FFF5DB', color: '#896622' }}
            >
              <Clock3 aria-hidden="true" style={{ width: 28, height: 28 }} />
            </div>
          </div>

          <div className="text-center">
            <span className="badge-ge badge-ge-notice mb-0">Cadastro em análise</span>
            <h1 className="type-title mt-6 mb-0" style={{ fontSize: 30, fontWeight: 800 }}>
              Aguardando aprovação
            </h1>
            <p className="mt-4 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Olá, {userName}. Sua conta de professor será ativada após a análise do administrador.
            </p>
            <p className="mt-6 mb-0 rounded-3 bg-ge-light p-4 fw-medium text-center">
              {email}
            </p>
          </div>

          <div className="alert alert-warning mt-12 d-flex align-items-start gap-4 rounded-3 border-0" role="alert"
               style={{ backgroundColor: '#FFFDF7', color: '#896622' }}>
            <ShieldCheck aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }} />
            <div className="flex-grow-1">
              <h2 className="alert-heading mb-1 fw-bold" style={{ fontSize: 15 }}>
                Acesso restrito até a decisão
              </h2>
              <p className="mb-0" style={{ fontSize: 14, lineHeight: 1.6 }}>
                As ferramentas do professor ficam indisponíveis enquanto o cadastro estiver pendente.
                Esta tela verifica o status automaticamente.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ge-outline w-100 d-flex align-items-center justify-content-center gap-2 mt-12 fw-medium"
            style={{ borderRadius: 16 }}
            onClick={() => void refreshSession()}
          >
            <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
            Verificar novamente
          </button>
        </div>
      </div>
    </main>
  )
}
