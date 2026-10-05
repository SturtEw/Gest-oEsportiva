import { CircleHelp } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import type { TeacherEnrollment } from '@/hooks/useTeacherEnrollment'
import { InviteCodesCard } from './InviteCodesCard'
import { JoinRequestsCard } from './JoinRequestsCard'

/**
 * Teacher view "Convites e pedidos": the request queue first (it needs action), then codes.
 * The page title comes from TeacherArea, like every other teacher section.
 */
export function TeacherEnrollmentPanel({ enrollment, readOnly }: { enrollment: TeacherEnrollment; readOnly?: boolean }) {
  const firstLoad = enrollment.loading && enrollment.inviteClasses.length === 0 && enrollment.pending.length === 0

  return (
    <div className="space-y-5">
      {enrollment.error && (
        <Alert variant="destructive">
          <CircleHelp aria-hidden="true" />
          <AlertDescription>{enrollment.error}</AlertDescription>
        </Alert>
      )}

      {firstLoad ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <JoinRequestsCard
            pending={enrollment.pending}
            history={enrollment.history}
            pendingCount={enrollment.pendingCount}
            onDecide={enrollment.decide}
            readOnly={readOnly}
          />
          <InviteCodesCard
            classes={enrollment.inviteClasses}
            onGenerate={enrollment.generateInvite}
            onRevoke={enrollment.revokeInvite}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  )
}
