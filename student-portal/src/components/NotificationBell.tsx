import { useState } from 'react'
import { Bell, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/hooks/useNotifications'
import { formatDateTime } from '@/lib/formatters'
import type { AppNotification } from '@/lib/types'

/**
 * Sino de notificações in-app (área do aluno).
 *
 * O badge mostra não lidas; ao abrir o sino, tudo é marcado como lido e o
 * badge zera — sem depender de recarregar a página.
 */
export function NotificationBell({ revision = 0 }: { revision?: number }) {
  const [open, setOpen] = useState(false)
  const { notifications, unread, markRead, markAllRead, loading, error } = useNotifications({ revision })

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : 'Notificações'}
        onClick={() => setOpen((value) => !value)}
        className="relative"
      >
        <Bell aria-hidden="true" />
        {unread > 0 && (
          <span
            data-testid="notif-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border bg-card p-3 shadow-lg" role="dialog" aria-label="Notificações">
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-bold">Notificações</p>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 gap-1 text-xs">
                <Check aria-hidden="true" className="size-3" /> Marcar todas como lidas
              </Button>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {notifications.length === 0 && !loading && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nada por aqui ainda.</p>
            )}
            {notifications.map((item) => (
              <NotificationRow key={item.id} item={item} onRead={() => markRead(item.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NotificationRow({ item, onRead }: { item: AppNotification; onRead: () => void }) {
  return (
    <div className={`rounded-lg border p-2 text-sm ${item.lida ? 'opacity-60' : 'font-medium'}`}>
      <div className="flex items-start justify-between gap-2">
        <p>{item.titulo}</p>
        {!item.lida && (
          <Button variant="ghost" size="icon" aria-label="Marcar como lida" onClick={onRead} className="h-6 w-6">
            <X aria-hidden="true" className="size-3" />
          </Button>
        )}
      </div>
      {item.mensagem && <p className="mt-0.5 text-xs text-muted-foreground">{item.mensagem}</p>}
      <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(item.criado_em)}</p>
    </div>
  )
}
