import '@/styles/bootstrap-theme.scss'
import { useState, type FormEvent } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'

/** /reset-senha?token= — choose a new password from the e-mailed link. Bootstrap. */
export function ResetPasswordScreen({ initialToken }: { initialToken: string | null }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasToken = initialToken && initialToken.trim().length > 40

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!hasToken) { setError('Link inválido ou expirado. Solicite um novo link de recuperação.'); return }
    if (newPassword.length < 10) { setError('A senha precisa ter pelo menos 10 caracteres.'); return }
    if (newPassword !== confirmPassword) { setError('As senhas digitadas não coincidem.'); return }
    setLoading(true)
    try {
      await api.resetPassword(initialToken!, newPassword)
      setSuccess(true)
    } catch (cause) {
      setSuccess(false)
      setError(cause instanceof Error ? cause.message : 'Não foi possível redefinir sua senha.')
    } finally { setLoading(false) }
  }

  const goToLogin = () => {
    const clean = new URL(window.location.href)
    clean.searchParams.delete('token')
    clean.pathname = clean.pathname.replace(/reset-senha\/?$/i, '') || '/'
    window.location.href = clean.toString()
  }

  return (
    <main className="d-flex align-items-center justify-content-center bg-body min-vh-100 px-6 py-12">
      <div className="portal-card p-6 sm:p-12" style={{ maxWidth: 520, width: '100%' }}>
        <div className="d-flex justify-content-center mb-6">
          <div
            className="d-flex align-items-center justify-content-center rounded-4"
            style={{
              width: 56, height: 56,
              backgroundColor: success ? '#EAF0E5' : error || !hasToken ? '#FFF0E9' : '#F1EEF7',
              color: success ? '#668C5D' : error || !hasToken ? '#B7542B' : '#63547F',
            }}
          >
            {success ? (
              <CheckCircle2 aria-hidden="true" style={{ width: 28, height: 28 }} />
            ) : (
              <KeyRound aria-hidden="true" style={{ width: 28, height: 28 }} />
            )}
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="type-title mb-0" style={{ fontSize: 26, fontWeight: 800, color: '#18372F' }}>
            {success ? 'Senha redefinida' : !hasToken ? 'Link inválido' : 'Criar nova senha'}
          </h1>
          <p className="mt-4 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {success
              ? 'Sua senha foi atualizada com sucesso. Use a nova senha para entrar na sua conta.'
              : !hasToken
                ? 'Este link de recuperação está incompleto ou já expirou. Solicite um novo link na tela de login.'
                : 'Digite uma nova senha segura com pelo menos 10 caracteres. Não reutilize senhas antigas.'}
          </p>
        </div>

        {error && (
          <div className="alert alert-danger d-flex align-items-start gap-2 rounded-3 mb-6" role="alert" style={{ fontSize: 14 }}>
            <span className="mt-1 d-flex"><AlertCircle aria-hidden="true" style={{ width: 18, height: 18 }} /></span>
            <div className="flex-grow-1">{error}</div>
          </div>
        )}

        {success ? (
          <button
            type="button"
            className="btn btn-ge-primary w-100 d-flex align-items-center justify-content-center gap-2 fw-bold"
            style={{ height: 48, borderRadius: 16 }}
            onClick={goToLogin}
          >
            Ir para a tela de login
            <Mail aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
        ) : hasToken ? (
          <form className="d-grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <div className="position-relative">
              <label htmlFor="reset-new" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Nova senha</label>
              <div className="position-relative">
                <span className="input-icon-start" aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#66806D' }}>
                  <KeyRound style={{ width: 18, height: 18 }} />
                </span>
                <input
                  id="reset-new"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={72}
                  required
                  className="form-control"
                  style={{ height: 51, borderRadius: 14, paddingLeft: 44, paddingRight: 44 }}
                  placeholder=" "
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="link-secondary"
                  aria-label={showNew ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, padding: 4, color: '#66806D' }}
                >
                  {showNew ? <EyeOff aria-hidden="true" style={{ width: 18, height: 18 }} /> : <Eye aria-hidden="true" style={{ width: 18, height: 18 }} />}
                </button>
              </div>
              <div className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>Mínimo de 10 caracteres.</div>
            </div>

            <div className="position-relative">
              <label htmlFor="reset-confirm" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Confirmar nova senha</label>
              <div className="position-relative">
                <span className="input-icon-start" aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#66806D' }}>
                  <ShieldCheck style={{ width: 18, height: 18 }} />
                </span>
                <input
                  id="reset-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={72}
                  required
                  className="form-control"
                  style={{ height: 51, borderRadius: 14, paddingLeft: 44, paddingRight: 44 }}
                  placeholder=" "
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="link-secondary"
                  aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, padding: 4, color: '#66806D' }}
                >
                  {showConfirm ? <EyeOff aria-hidden="true" style={{ width: 18, height: 18 }} /> : <Eye aria-hidden="true" style={{ width: 18, height: 18 }} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1"
              style={{ height: 48, borderRadius: 16 }}
            >
              {loading ? 'Redefinindo…' : 'Redefinir senha'}
            </button>
          </form>
        ) : null}

        <button
          type="button"
          className="btn btn-outline-secondary mt-4 w-100 d-flex align-items-center justify-content-center gap-2 border-0 text-ge-muted"
          style={{ borderRadius: 16 }}
          onClick={goToLogin}
        >
          <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
          Voltar para entrar
        </button>
      </div>
    </main>
  )
}
