import { useEffect, useState } from 'react'
import { ChevronDown, Shield } from 'lucide-react'
import { useImpersonation, type ImpersonatedRole, type ViewTarget } from '@/hooks/useImpersonation'
import { request } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

interface Targets { professores: ViewTarget[]; alunos: ViewTarget[] }

export function RoleSelector() {
  const { originalIsRootAdmin, isImpersonating, setViewAs } = useImpersonation()
  const [targets, setTargets] = useState<Targets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<ImpersonatedRole>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!originalIsRootAdmin || isImpersonating || !open || targets) return
    let active = true
    void request<Targets>('/api/admin/view-as-targets')
      .then((result) => { if (active) setTargets(result) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível listar os perfis.') })
    return () => { active = false }
  }, [originalIsRootAdmin, isImpersonating, open, targets])

  if (!originalIsRootAdmin || isImpersonating) return null
  const options = role === 'professor' ? targets?.professores : targets?.alunos
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} aria-label="Visualizar como outro perfil">
      <Shield className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Visão de Admin</span>
      <ChevronDown className="size-4" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="max-h-80 w-72 overflow-y-auto" align="end">
      <DropdownMenuLabel>Visualizar como · somente leitura</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled>Visão de Admin (atual)</DropdownMenuItem>
      <DropdownMenuItem onClick={(event) => { event.preventDefault(); setRole('professor') }}>Visão de Professor</DropdownMenuItem>
      <DropdownMenuItem onClick={(event) => { event.preventDefault(); setRole('aluno') }}>Visão de Aluno</DropdownMenuItem>
      {role && <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Selecione {role === 'aluno' ? 'um aluno' : 'um professor'} real</DropdownMenuLabel>
        {error && <p role="alert" className="px-2 text-sm text-destructive">{error}</p>}
        {!targets && !error && <p className="px-2 text-sm">Carregando perfis…</p>}
        {options?.length === 0 && <p className="px-2 text-sm">Nenhuma conta ativa disponível.</p>}
        {options?.map((target) => <DropdownMenuItem key={target.id} onClick={() => { setViewAs(role, target); setRole(null) }}>
          {target.nome}
        </DropdownMenuItem>)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}
