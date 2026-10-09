import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials, formatTime } from '@/lib/formatters'
import type { ForumMessage } from '@/lib/types'
import { cn } from 'cn'

interface Props {
  message: ForumMessage
  /** The signed-in user's id: own messages align right (WhatsApp style). */
  myUserId: string
  /** Show the author name above the bubble (grouped consecutive messages). */
  showAuthor: boolean
}

export function MessageBubble({ message, myUserId, showAuthor }: Props) {
  const mine = message.autor_id === myUserId
  const isTeacher = message.autor_tipo === 'professor'

  return (
    <li className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start')} data-mine={mine || undefined}>
      {!mine && (
        <Avatar className="mt-1 size-8 shrink-0 bg-secondary">
          {message.autor_avatar && <AvatarImage src={message.autor_avatar} alt="" />}
          <AvatarFallback className={cn('text-[10px] font-bold', isTeacher ? 'bg-accent-soft text-on-accent-soft' : 'bg-secondary text-secondary-foreground')}>
            {initials(message.autor_nome)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className={cn('max-w-[78%] sm:max-w-[65%]', mine && 'items-end text-right')}>
        {showAuthor && !mine && (
          <p className={cn('mb-0.5 text-[11px] font-bold', isTeacher ? 'text-on-soft' : 'text-muted-foreground')}>
            {message.autor_nome}{isTeacher && ' · Professor'}
          </p>
        )}
        <div className={cn(
          'rounded-2xl px-3.5 py-2 text-sm leading-6 shadow-sm',
          mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted text-foreground',
        )}>
          <p className="whitespace-pre-wrap break-words">{message.texto}</p>
          <p className={cn('mt-1 text-right text-[10px] tabular-nums', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {formatTime(message.criado_em)}
          </p>
        </div>
      </div>
    </li>
  )
}
