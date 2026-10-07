/**
 * Self-service account management, shared by teachers and students:
 * profile data, avatar (preset gallery + upload), password and danger zone.
 * Destructive actions always demand the current password in a warning modal.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Eye, EyeOff, KeyRound, ShieldAlert, Trash2, Upload, UserRound, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type AccountInfo } from '@/lib/api'
import { initials } from '@/lib/formatters'
import { AVATAR_CATEGORIES, avatarUrl } from './avatars'

type DangerAction = 'desativar' | 'excluir' | null

interface Props {
  sessionUser: { nome: string; email?: string | null; tipo: string; tem_senha?: boolean }
  onAccountChanged?: () => void
  onSignedOut: () => void
}

export function AccountManagement({ sessionUser, onAccountChanged, onSignedOut }: Props) {
  const [conta, setConta] = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Profile form
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Avatar
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState(AVATAR_CATEGORIES[0].id)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // Danger zone
  const [dangerAction, setDangerAction] = useState<DangerAction>(null)
  const [dangerPassword, setDangerPassword] = useState('')
  const [dangerBusy, setDangerBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api.accountGet()
      .then((result) => {
        if (!active) return
        setConta(result.conta)
        setNome(result.conta.nome)
        setTelefone(result.conta.telefone ?? '')
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua conta.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const saveProfile = async () => {
    if (nome.trim().length < 3 || savingProfile) return
    setSavingProfile(true)
    setError(null)
    try {
      const result = await api.accountUpdate({ nome: nome.trim(), telefone: telefone.trim() || null })
      setConta(result.conta)
      setNotice('Dados da conta atualizados.')
      onAccountChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os dados.') }
    finally { setSavingProfile(false) }
  }

  const choosePreset = async (avatarId: string) => {
    setAvatarBusy(true)
    setError(null)
    try {
      const result = await api.setPresetAvatar(avatarId)
      setConta(result.conta)
      setPickerOpen(false)
      setNotice('Avatar atualizado.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o avatar.') }
    finally { setAvatarBusy(false) }
  }

  const uploadPhoto = async (file: File) => {
    if (file.size > 512 * 1024) { setError('A foto deve ter no máximo 512 KB.'); return }
    setAvatarBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
        reader.readAsDataURL(file)
      })
      const result = await api.uploadAvatar(dataUrl)
      setConta(result.conta)
      setNotice('Foto de perfil atualizada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a foto.') }
    finally { setAvatarBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const removePhoto = async () => {
    setAvatarBusy(true)
    try {
      const result = await api.removeAvatar()
      setConta(result.conta)
      setNotice('Avatar removido.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover o avatar.') }
    finally { setAvatarBusy(false) }
  }

  const changePassword = async () => {
    if (newPassword.length < 12 || !currentPassword || savingPassword) return
    setSavingPassword(true)
    setError(null)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setNotice('Senha alterada com sucesso. Use a nova senha no próximo login.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.') }
    finally { setSavingPassword(false) }
  }

  const runDanger = async () => {
    if (!dangerAction || !dangerPassword || dangerBusy) return
    setDangerBusy(true)
    setError(null)
    try {
      if (dangerAction === 'desativar') {
        const result = await api.deactivate(dangerPassword)
        // Tokens were revoked server-side: the session is over.
        setNotice(result.message)
        window.setTimeout(() => onSignedOut(), 1200)
      } else {
        await api.deleteAccount(dangerPassword)
        window.setTimeout(() => onSignedOut(), 400)
      }
      setDangerAction(null)
      setDangerPassword('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.') }
    finally { setDangerBusy(false) }
  }

  if (loading) return <Skeleton className="h-96 rounded-2xl" />

  const avatarSrc = conta?.avatar?.tipo === 'upload' ? conta.avatar.image_base64
    : conta?.avatar?.tipo === 'preset' ? avatarUrl(conta.avatar.avatar_id ?? '')
      : undefined

  return (
    <div className="space-y-5">
      {notice && (
        <Alert className="border-[#D5E6CE] bg-[#F6FAF2]">
          <Check aria-hidden="true" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <Button variant="ghost" size="icon-xs" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="ghost" size="icon-xs" aria-label="Fechar aviso" onClick={() => setError(null)}><X aria-hidden="true" /></Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Dados da conta ── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><UserRound className="size-5" /> Dados da conta</CardTitle>
          <CardDescription>Nome, e-mail e telefone usados pela escola para identificar você.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar className="size-16">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt={`Avatar de ${conta?.nome}`} /> : null}
              <AvatarFallback className="text-lg font-bold">{initials(conta?.nome ?? sessionUser.nome)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-xl" disabled={avatarBusy} onClick={() => setPickerOpen(true)}>Escolher avatar</Button>
              <Button variant="outline" className="rounded-xl" disabled={avatarBusy} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Enviar foto
              </Button>
              {(conta?.avatar) && (
                <Button variant="ghost" className="rounded-xl text-red-700" disabled={avatarBusy} onClick={() => void removePhoto()}>Remover</Button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file) }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPEG ou WEBP até 512 KB. Avatares pré-definidos ficam prontos na galeria.</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="account-name">Nome</FieldLabel>
              <Input id="account-name" value={nome} onChange={(event) => setNome(event.target.value)} minLength={3} maxLength={120} className="mt-1 h-11 rounded-xl" />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-phone">Telefone</FieldLabel>
              <Input id="account-phone" value={telefone} onChange={(event) => setTelefone(event.target.value)} maxLength={20} className="mt-1 h-11 rounded-xl" placeholder="(31) 99999-0000" />
            </Field>
            <Field>
              <FieldLabel>E-mail</FieldLabel>
              <Input value={conta?.email ?? sessionUser.email ?? ''} disabled className="mt-1 h-11 rounded-xl bg-muted" />
              <FieldDescription>O e-mail de acesso não pode ser alterado por aqui.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Situação</FieldLabel>
              <div className="mt-1 flex h-11 items-center">
                <Badge className="rounded-full" variant={conta?.status === 'ativo' ? 'default' : 'secondary'}>
                  {conta?.status === 'ativo' ? 'Conta ativa' : `Conta ${conta?.status}`}
                </Badge>
              </div>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button className="rounded-xl" disabled={nome.trim().length < 3 || savingProfile} onClick={() => void saveProfile()}>
              {savingProfile ? 'Salvando…' : 'Salvar dados'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Senha ── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><KeyRound className="size-5" /> Alterar senha</CardTitle>
          <CardDescription>Mínimo de 12 caracteres. Ao alterar, todas as sessões ativas são encerradas por segurança.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="current-password">Senha atual</FieldLabel>
            <div className="relative mt-1">
              <Input id="current-password" type={showPasswords ? 'text' : 'password'} value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className="h-11 rounded-xl pr-10" />
              <button type="button" aria-label={showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'} onClick={() => setShowPasswords((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">Nova senha</FieldLabel>
            <Input id="new-password" type={showPasswords ? 'text' : 'password'} value={newPassword} minLength={12} maxLength={72}
              onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" className="mt-1 h-11 rounded-xl" />
            <FieldDescription>Esqueceu a senha atual? Use “Não sei minha senha” na tela de login para receber um link de redefinição.</FieldDescription>
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button className="rounded-xl" disabled={!currentPassword || newPassword.length < 12 || savingPassword} onClick={() => void changePassword()}>
              {savingPassword ? 'Alterando…' : 'Alterar senha'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Zona de perigo ── */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-red-800"><ShieldAlert className="size-5" /> Zona de perigo</CardTitle>
          <CardDescription>Ações irreversíveis ou de grande impacto. Ambas exigem sua senha para confirmar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-[#FFF9EC] p-4">
            <h3 className="font-semibold text-amber-900">Desativar conta</h3>
            <p className="mt-1 text-sm text-amber-800">Você sai do sistema e é desvinculado das turmas ativas. Seus dados são preservados e a conta volta ao normal no próximo login — sem criar nada de novo.</p>
            <Button variant="outline" className="mt-3 rounded-xl border-amber-300 text-amber-900 hover:bg-amber-100"
              onClick={() => { setDangerAction('desativar'); setDangerPassword('') }}>
              Desativar minha conta
            </Button>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-900">Excluir conta</h3>
            <p className="mt-1 text-sm text-red-800">Apaga definitivamente seu perfil e todos os vínculos com turmas. Para voltar, será preciso criar uma conta nova — o e-mail fica liberado.</p>
            <Button variant="destructive" className="mt-3 rounded-xl"
              onClick={() => { setDangerAction('excluir'); setDangerPassword('') }}>
              <Trash2 className="size-4" /> Excluir minha conta
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Galeria de avatares ── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Escolher avatar</DialogTitle>
            <DialogDescription>Avatares prontos organizados por categoria.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_CATEGORIES.map((category) => (
              <button key={category.id} type="button" aria-pressed={activeCategory === category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${activeCategory === category.id ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                {category.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {Array.from({ length: AVATAR_CATEGORIES.find((item) => item.id === activeCategory)?.count ?? 8 }, (_, index) => {
              const id = `${activeCategory}-${index + 1}`
              const selected = conta?.avatar?.tipo === 'preset' && conta.avatar.avatar_id === id
              return (
                <button key={id} type="button" disabled={avatarBusy} aria-pressed={selected} aria-label={`Avatar ${id}`}
                  onClick={() => void choosePreset(id)}
                  className={`rounded-xl border p-1 transition ${selected ? 'border-primary ring-2 ring-primary' : 'hover:border-primary/50'}`}>
                  <img src={avatarUrl(id)} alt="" width={72} height={72} loading="lazy" className="size-full" />
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal de aviso destrutivo ── */}
      <Dialog open={Boolean(dangerAction)} onOpenChange={(open) => { if (!open && !dangerBusy) { setDangerAction(null); setDangerPassword('') } }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2 text-red-800">
              <ShieldAlert aria-hidden="true" />
              {dangerAction === 'desativar' ? 'Desativar sua conta?' : 'Excluir sua conta definitivamente?'}
            </DialogTitle>
            <DialogDescription>
              {dangerAction === 'desativar'
                ? 'Você será desconectado e desvinculado de todas as turmas ativas. Seus dados permanecem guardados: basta fazer login novamente para reativar a conta. Nenhuma informação é apagada.'
                : 'Esta ação é PERMANENTE. Seu perfil e todos os vínculos com turmas serão apagados do sistema. Para usar o site novamente no futuro, será necessário criar uma conta totalmente nova — seu e-mail atual fica liberado para um novo cadastro. Não há como desfazer.'}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="danger-password">Digite sua senha atual para confirmar</FieldLabel>
            <Input id="danger-password" type="password" value={dangerPassword} autoComplete="current-password"
              onChange={(event) => setDangerPassword(event.target.value)} className="mt-1 h-11 rounded-xl" />
            <FieldDescription>Só confirmamos com a senha correta da conta.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" disabled={dangerBusy} onClick={() => { setDangerAction(null); setDangerPassword('') }}>Cancelar</Button>
            <Button variant="destructive" disabled={!dangerPassword || dangerBusy} onClick={() => void runDanger()}>
              {dangerBusy ? 'Processando…' : dangerAction === 'desativar' ? 'Confirmar desativação' : 'Excluir para sempre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
