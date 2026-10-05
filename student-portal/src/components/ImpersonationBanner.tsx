/**
 * Impersonation Banner - Shows when admin is viewing as another role
 * Fixed banner at top with clear visual indicator and quick exit button
 */
import { useImpersonation } from '@/hooks/useImpersonation'
import { X, User, Shield, Eye } from 'lucide-react'
// No `cn` here: this banner is in the initial bundle and its classes never
// conflict, so plain concatenation keeps tailwind-merge out of the entry chunk.

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  professor: 'Professor',
  aluno: 'Aluno',
  responsavel: 'Responsável',
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <Shield className="size-4" aria-hidden="true" />,
  professor: <User className="size-4" aria-hidden="true" />,
  aluno: <Eye className="size-4" aria-hidden="true" />,
  responsavel: <User className="size-4" aria-hidden="true" />,
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  professor: 'bg-blue-50 border-blue-200 text-blue-800',
  aluno: 'bg-amber-50 border-amber-200 text-amber-800',
  responsavel: 'bg-purple-50 border-purple-200 text-purple-800',
}

export function ImpersonationBanner() {
  const { impersonatedRole, target, originalIsRootAdmin, clearImpersonation } = useImpersonation()

  if (!impersonatedRole || !target || !originalIsRootAdmin) return null
  const roleLabel = ROLE_LABELS[impersonatedRole]
  const roleIcon = ROLE_ICONS[impersonatedRole]
  const roleColor = ROLE_COLORS[impersonatedRole]

  return (
    <div role="status" className={`sticky top-0 z-50 border-b ${roleColor}`}>
      <div className="mx-auto max-w-screen-2xl px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center rounded-lg px-2 py-1 ${roleColor}`}>
            {roleIcon}
          </div>
          <div>
            <p className="text-sm font-semibold">Visualizando como: {roleLabel} · {target.nome}</p>
            <p className="text-xs opacity-75">Admin Raiz · somente leitura</p>
          </div>
        </div>
        <button
          type="button"
          onClick={clearImpersonation}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label="Sair da visualização como outro usuário"
        >
          <X className="size-4" aria-hidden="true" />
          Voltar para Admin
        </button>
      </div>
    </div>
  )
}
