import { Check, CircleOff, LoaderCircle, RadioTower, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ConnectionStatus as Status } from '@/lib/types'
import { formatDateTime } from '@/lib/formatters'

const copy: Record<Status, { label: string; icon: typeof Check; className: string }> = {
  connecting: { label: 'Conectando', icon: LoaderCircle, className: 'bg-[#F1EEF7] text-[#63547F]' },
  live: { label: 'Ao vivo', icon: RadioTower, className: 'bg-[#EAF3E5] text-[#3F6E47]' },
  reconnecting: { label: 'Reconectando', icon: RefreshCw, className: 'bg-[#FFF5DB] text-[#896622]' },
  offline: { label: 'Sem conexão', icon: CircleOff, className: 'bg-[#FFF0E9] text-[#9B5737]' },
  single_worker: { label: 'Atualizações neste servidor', icon: RadioTower, className: 'bg-[#FFF5DB] text-[#896622]' },
}

export function ConnectionStatus({ status, message, lastUpdatedAt }: { status: Status; message: string; lastUpdatedAt: string | null }) {
  const item = copy[status]
  const Icon = item.icon
  const text = status === 'offline' && lastUpdatedAt ? `${item.label} · última atualização às ${formatDateTime(lastUpdatedAt)}` : item.label
  return <div className="group/status relative" title={message}>
    <Badge variant="outline" aria-live="polite" aria-label={`${text}. ${message}`} className={`h-8 gap-1.5 rounded-full border-transparent px-3 text-[11px] font-semibold ${item.className}`}>
      <Icon aria-hidden="true" className={`size-3.5 ${status === 'live' ? 'animate-pulse' : status === 'connecting' || status === 'reconnecting' ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{text}</span><span className="sm:hidden">{item.label}</span>
    </Badge>
    <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-72 rounded-xl border border-border bg-white p-3 text-xs leading-5 text-muted-foreground shadow-lg group-hover/status:block group-focus-within/status:block">{message}</div>
  </div>
}
