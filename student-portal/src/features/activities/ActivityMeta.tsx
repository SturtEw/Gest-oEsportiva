import { CalendarDays, MapPin, Users } from 'lucide-react'
import { formatActivityWhen, seatsLabel } from '@/lib/bracket'
import type { ActivitySummary } from '@/lib/types'

type MetaFields = Pick<ActivitySummary, 'data' | 'horario' | 'local' | 'vagas' | 'total_participantes'>

/** When, where and how many: the line under an activity's title. */
export function ActivityMeta({ activity, className }: { activity: MetaFields; className?: string }) {
  const when = formatActivityWhen(activity.data, activity.horario)
  // The wrapper takes the spacing: the list's m-0! (Bootstrap reset) would cancel
  // a parent's space-y or a margin passed in className.
  return (
    <div className={className}>
    <ul className="m-0! flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0! text-xs text-muted-foreground">
      {when && (
        <li className="flex items-center gap-1.5">
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{when.charAt(0).toLocaleUpperCase('pt-BR') + when.slice(1)}</span>
        </li>
      )}
      {activity.local && (
        <li className="flex min-w-0 items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{activity.local}</span>
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <Users aria-hidden="true" className="size-3.5 shrink-0" />
        {seatsLabel(activity)}
      </li>
    </ul>
    </div>
  )
}
