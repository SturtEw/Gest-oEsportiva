import { Ban, CheckCircle2, Clock3, XCircle, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { JoinRequestStatus } from '@/lib/types'
import { cn } from 'cn'

const STATUS: Record<JoinRequestStatus, { label: string; icon: LucideIcon; className: string }> = {
  pendente: { label: 'Pendente', icon: Clock3, className: 'border-notice-border bg-notice text-notice-foreground' },
  aprovada: { label: 'Aprovada', icon: CheckCircle2, className: 'border-transparent bg-secondary text-secondary-foreground' },
  rejeitada: { label: 'Rejeitada', icon: XCircle, className: 'border-transparent bg-danger-soft text-danger-soft-foreground' },
  cancelada: { label: 'Cancelada', icon: Ban, className: 'border-transparent bg-muted text-muted-foreground' },
}

/** Status of a join request, shared by the student home and the teacher panel. */
export function RequestStatusBadge({ status, className }: { status: JoinRequestStatus; className?: string }) {
  const meta = STATUS[status]
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn('rounded-full', meta.className, className)}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {meta.label}
    </Badge>
  )
}
