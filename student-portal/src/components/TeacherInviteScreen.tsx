import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Briefcase, CheckCircle2, Clock3, LockKeyhole, LogOut, Mail, ShieldCheck, Sparkles, User, Users } from 'lucide-react'
import { toast } from 'sonner'
import { AuthShell, FloatingLabelInput, type AuthHeroCopy } from '@/components/LoginScreen'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/formatters'
import { GoogleAuthError, mountGoogleSignInButton, type GoogleButtonHandle } from '@/lib/google-identity'
import { leaveTeacherInvitePath } from '@/lib/teacher-invite'
import type { SessionUser, TeacherInvitePreview } from '@/lib/types'

const TEACHER_HERO: AuthHeroCopy = {
  badge: 'Convite da escola',
  title: 'Sua turma está esperando.',
  description: 'Registre chamadas, acompanhe a evolução dos alunos e responda às dúvidas em um só lugar.',
  footer: 'O acesso de professor é criado somente por convite do administrador.',
}

type DocumentType = 'cpf' | 'rg' | 'outro' | ''

interface Props {
  token: string
  /** Someone already signed in on this browser. Registering would replace that session. */
  signedInAs?: Pick<SessionUser, 'nome' | 'email'> | null
  onRegistered: (user: SessionUser) => void
  onLogout: () => void
  onLeave: () => void
}

/** `/convite-professor?token=...`: signup for a teacher invited by the root admin. */
export function TeacherInviteScreen({ token, signedInAs, onRegistered, onLogout, onLeave }: Props) {
  const [invite, setInvite] = useState<TeacherInvitePreview | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(token ? null : 'Este link de convite está incompleto. Peça um novo link ao administrador da escola.')
  const [loadingInvite, setLoadingInvite] = useState(Boolean(token))

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [documentType, setDocumentType] = useState<DocumentType>('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [education, setEducation] = useState('')
  const [field, setField] = useState('')
  const [provider, setProvider] = useState<'email' | 'google'>('email')
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [googleClientId, setGoogleClientId] = useState<string | null>(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? null)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleHandleRef = useRef<GoogleButtonHandle | null>(null)

  useEffect(() => {
    if (!token) return
    let active = true
    api.teacherInvitePreview(token)
      .then((preview) => {
        if (!active) return
        setInvite(preview)
        setFullName((current) => current || preview.nome || '')
      })
      .catch((cause: unknown) => { if (active) setInviteError(cause instanceof Error ? cause.message : 'Não foi possível abrir o convite.') })
      .finally(() => { if (active) setLoadingInvite(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    let active = true
    api.googleConfig().then(({ client_id }) => { if (active && client_id) setGoogleClientId(client_id) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  // Google's button lives in its own node; mount it once the form is on screen.
  const showForm = Boolean(invite) && !signedInAs
  useEffect(() => {
    const container = googleButtonRef.current
    if (!container || !googleClientId || !showForm || googleToken) return
    let active = true
    void mountGoogleSignInButton({
      clientId: googleClientId,
      container,
      text: 'signup_with',
      onCredential: (credential) => {
        if (!active) return
        setGoogleToken(credential)
        setProvider('google')
        setError(null)
      },
      onError: (cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível validar a conta Google.') },
    })
      .then((handle) => { if (active) googleHandleRef.current = handle; else handle.destroy() })
      .catch((cause: unknown) => { if (active) setError(cause instanceof GoogleAuthError ? cause.message : 'Não foi possível carregar o acesso com Google.') })
    return () => {
      active = false
      googleHandleRef.current?.destroy()
      googleHandleRef.current = null
    }
  }, [googleClientId, showForm, googleToken])

  const switchToPassword = () => { setGoogleToken(null); setProvider('email'); setError(null) }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (fullName.trim().length < 3) { setError('Informe seu nome completo.'); return }
    if (provider === 'email' && password.length < 10) { setError('A senha precisa ter pelo menos 10 caracteres.'); return }
    if (documentType && documentNumber.replace(/[^0-9A-Za-z]/g, '').length < 5) { setError('Informe um documento válido.'); return }
    if (education.trim().length < 2 || field.trim().length < 2) { setError('Informe sua formação e a área em que atua.'); return }
    setSubmitting(true)
    try {
      const result = await api.registerTeacher({
        token,
        provider,
        ...(provider === 'google' && googleToken ? { credential: googleToken } : {}),
        ...(provider === 'email' ? { senha: password } : {}),
        nome: fullName.trim(),
        documento_tipo: documentType || undefined,
        documento_numero: documentType ? documentNumber : undefined,
        formacao_academica: education.trim(),
        area_atuacao: field.trim(),
      })
      leaveTeacherInvitePath()
      if (result.turma) toast.success(`Bem-vindo! A turma ${result.turma.nome} já está com você.`)
      else toast.success('Bem-vindo! Seu acesso de professor está pronto.')
      if (result.aviso) toast.warning(result.aviso)
      onRegistered(result.user)
    } catch (cause) {
      // A Google credential is single use; ask for a fresh one on retry.
      if (provider === 'google') switchToPassword()
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir seu cadastro.')
    } finally { setSubmitting(false) }
  }

  const backToLogin = () => { leaveTeacherInvitePath(); onLeave() }

  return (
    <AuthShell hero={TEACHER_HERO}>
      <div className="mb-8 text-center">
        <p className="mb-4 d-inline-flex align-items-center gap-2 text-ge-success fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.14em' }}>
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16 }} />
          Convite de professor
        </p>
        <h1 className="type-title mb-0" style={{ fontSize: 32, fontWeight: 800, color: '#18372F' }}>
          {inviteError ? 'Convite indisponível' : 'Crie seu acesso de professor'}
        </h1>
        {!inviteError && (
          <p className="mx-auto mt-4 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 440 }}>
            A escola convidou você. Preencha seus dados uma única vez: ao concluir, você já entra na área do professor.
          </p>
        )}
      </div>

      {loadingInvite ? (
        <div className="space-y-3" role="status" aria-label="Carregando convite">
          <div className="h-20 animate-pulse rounded-2xl bg-ge-light" />
          <div className="h-12 animate-pulse rounded-2xl bg-ge-light" />
          <div className="h-12 animate-pulse rounded-2xl bg-ge-light" />
        </div>
      ) : inviteError ? (
        <div className="d-flex flex-column align-items-center text-center">
          <div className="d-flex align-items-center justify-content-center rounded-4" style={{ width: 56, height: 56, backgroundColor: '#FFF0E9', color: '#B7542B' }}>
            <AlertCircle aria-hidden="true" style={{ width: 28, height: 28 }} />
          </div>
          <p className="mt-6 mb-0 text-ge-muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 400 }} role="alert">{inviteError}</p>
          <p className="mt-4 mb-0 text-ge-muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 400 }}>
            Se você já concluiu o cadastro, entre normalmente com seu e-mail.
          </p>
          <button type="button" className="btn btn-ge-primary mt-8 w-100 d-flex align-items-center justify-content-center gap-2 fw-bold" style={{ height: 48 }} onClick={backToLogin}>
            Ir para a tela de entrada
            <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
        </div>
      ) : invite && (
        <>
          <InviteSummary invite={invite} />

          {signedInAs ? (
            <div className="mt-6">
              <div className="alert alert-warning d-flex align-items-start gap-3 rounded-3 border-0" role="alert" style={{ backgroundColor: '#FFFDF7', color: '#896622' }}>
                <ShieldCheck aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }} />
                <div className="flex-grow-1" style={{ fontSize: 14, lineHeight: 1.6 }}>
                  Você está conectado como <strong>{signedInAs.nome}</strong> ({signedInAs.email}). Saia desta conta para criar o acesso de professor de {invite.email}.
                </div>
              </div>
              <div className="mt-6 d-flex flex-column gap-2">
                <button type="button" className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold" style={{ height: 48 }} onClick={onLogout}>
                  Sair e continuar com o convite
                  <LogOut aria-hidden="true" style={{ width: 18, height: 18 }} />
                </button>
                <button type="button" className="btn btn-ge-outline d-flex align-items-center justify-content-center gap-2 fw-medium" onClick={backToLogin}>
                  <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
                  Voltar ao portal
                </button>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-danger mt-6 d-flex align-items-start gap-2 rounded-3" role="alert">
                  <span className="mt-1 d-flex"><AlertCircle aria-hidden="true" style={{ width: 18, height: 18 }} /></span>
                  <div className="flex-grow-1" style={{ fontSize: 14 }}>{error}</div>
                </div>
              )}

              <form className="mt-6 d-grid gap-4" onSubmit={(event) => void submit(event)} noValidate>
                {provider === 'google' && googleToken ? (
                  <div className="alert alert-success rounded-3 d-flex align-items-start gap-2 mb-0" role="status" style={{ backgroundColor: '#F5FAF1', borderColor: '#D8E5CF', color: '#183C32' }}>
                    <CheckCircle2 aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }} />
                    <div className="flex-grow-1" style={{ fontSize: 14 }}>
                      Conta Google selecionada. Você vai entrar com ela, sem senha.{' '}
                      <button type="button" className="btn btn-link p-0 align-baseline fw-semibold text-ge-primary" style={{ fontSize: 14 }} onClick={switchToPassword}>Usar senha</button>
                    </div>
                  </div>
                ) : null}

                <FloatingLabelInput id="teacher-name" label="Nome completo" autoComplete="name" required minLength={3} maxLength={120} value={fullName} onValueChange={setFullName} icon={User} />

                {provider === 'email' && (
                  <div>
                    <FloatingLabelInput
                      id="teacher-password" label="Crie uma senha" autoComplete="new-password" required minLength={10} maxLength={72}
                      value={password} onValueChange={setPassword} icon={LockKeyhole}
                      showPassword={showPassword} onTogglePassword={() => setShowPassword((value) => !value)}
                    />
                    <div className="form-text mt-1 ps-1 text-ge-muted" style={{ fontSize: 12 }}>Mínimo de 10 caracteres. Você entra com {invite.email} e esta senha.</div>
                  </div>
                )}

                <div className="row g-3">
                  <div className="col-5">
                    <label htmlFor="teacher-document-type" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Documento <span aria-hidden="true" className="text-muted">(opcional)</span></label>
                    <select
                      id="teacher-document-type" className="form-select" value={documentType} style={{ height: 51, borderRadius: 14 }}
                      onChange={(event) => { const value = event.target.value; if (value === 'cpf' || value === 'rg' || value === 'outro' || value === '') setDocumentType(value) }}
                    >
                      <option value="">Não informar</option>
                      <option value="cpf">CPF</option>
                      <option value="rg">RG</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                  <div className="col-7">
                    <label htmlFor="teacher-document-number" className="form-label fw-semibold mb-1" style={{ fontSize: 14 }}>Número {documentType ? <span aria-hidden="true" className="text-danger">*</span> : <span aria-hidden="true" className="text-muted">(opcional)</span>}</label>
                    <input
                      id="teacher-document-number" type="text" required={Boolean(documentType)} disabled={!documentType} minLength={documentType ? 5 : undefined} maxLength={40} autoComplete="off"
                      value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)}
                      placeholder={documentType ? "Somente número ou letras" : "Escolha um tipo para informar"} className="form-control" style={{ height: 51, borderRadius: 14 }}
                    />
                  </div>
                  <div className="col-12">
                    <div className="form-text mt-0 ps-1 text-ge-muted" style={{ fontSize: 12 }}>Guardamos só uma versão cifrada e os 4 últimos dígitos.</div>
                  </div>
                </div>

                <FloatingLabelInput id="teacher-education" label="Formação acadêmica" autoComplete="off" required minLength={2} maxLength={160} value={education} onValueChange={setEducation} icon={BookOpen} />
                <FloatingLabelInput id="teacher-field" label="Área de atuação (ex.: futsal, vôlei)" autoComplete="off" required minLength={2} maxLength={160} value={field} onValueChange={setField} icon={Briefcase} />

                <button
                  type="submit" disabled={submitting}
                  className="btn btn-ge-primary d-flex align-items-center justify-content-center gap-2 fw-bold mt-1" style={{ height: 48 }}
                >
                  {submitting ? 'Criando acesso…' : 'Criar acesso e entrar'}
                  <ArrowRight aria-hidden="true" style={{ width: 18, height: 18 }} />
                </button>
              </form>

              {googleClientId && provider === 'email' && (
                <div className="mt-8">
                  <p className="hr-or mb-0">ou use sua conta Google</p>
                  <div ref={googleButtonRef} className="mt-4 flex min-h-[48px] w-full items-center justify-center" />
                  <p className="mt-2 mb-0 text-center text-ge-muted" style={{ fontSize: 12 }}>Use a conta Google de {invite.email}.</p>
                </div>
              )}

              <div className="mt-8 pt-6 text-center" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <p className="mb-0 text-ge-muted" style={{ fontSize: 14 }}>
                  Já tem uma conta?{' '}
                  <button type="button" className="btn btn-link p-0 fw-bold text-decoration-none text-ge-primary" onClick={backToLogin}>Entrar</button>
                </p>
              </div>
            </>
          )}
        </>
      )}
    </AuthShell>
  )
}

function InviteSummary({ invite }: { invite: TeacherInvitePreview }) {
  return (
    <dl className="mb-0 grid gap-3 rounded-2xl border px-5 py-4" style={{ borderColor: '#E1E9DB', backgroundColor: '#F7FAF4', fontSize: 14 }}>
      <div className="flex items-start gap-3">
        <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ge-success" />
        <div className="min-w-0"><dt className="text-ge-muted" style={{ fontSize: 12 }}>Convite para</dt><dd className="mb-0 fw-semibold">{invite.email}</dd></div>
      </div>
      {invite.turma && (
        <div className="flex items-start gap-3">
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ge-success" />
          <div className="min-w-0"><dt className="text-ge-muted" style={{ fontSize: 12 }}>Sua turma</dt><dd className="mb-0 fw-semibold">{[invite.turma.nome, invite.turma.modalidade].filter(Boolean).join(' · ')}</dd></div>
        </div>
      )}
      {invite.expira_em && (
        <div className="flex items-start gap-3">
          <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ge-success" />
          <div className="min-w-0"><dt className="text-ge-muted" style={{ fontSize: 12 }}>Válido até</dt><dd className="mb-0 fw-semibold">{formatDate(invite.expira_em)}</dd></div>
        </div>
      )}
    </dl>
  )
}
