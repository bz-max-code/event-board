import { useState } from 'react'
import { AuthOverlay, useAuth } from 'deepspace'
import { Clock } from 'lucide-react'
import { Badge, Button, ConfirmModal, useToast } from '@/components/ui'
import { CapacityBar } from './CapacityBar'
import { callAction } from '@/lib/actions'
import { formatTimeRange } from '@/lib/format'
import type { MyRegistration, SessionView } from '@/hooks/useBoard'

export function RegistrationBadge({ reg }: { reg: MyRegistration }) {
  if (reg.status === 'confirmed') {
    return (
      <Badge variant="success" data-testid="my-status">
        {reg.data.checkedInAt ? 'Checked in' : 'Registered'}
      </Badge>
    )
  }
  if (reg.status === 'waitlisted') {
    return (
      <Badge variant="warning" data-testid="my-status">
        Waitlist #{reg.waitlistPlace}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" data-testid="my-status">
      Processing…
    </Badge>
  )
}

/**
 * One session: live capacity bar plus the caller's register/waitlist/cancel
 * control. All writes go through server actions; the UI updates from the
 * realtime broadcast, not optimistically.
 */
export function SessionCard({ session, mine }: { session: SessionView; mine?: MyRegistration }) {
  const { isSignedIn } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)

  async function register() {
    if (!isSignedIn) return setShowSignIn(true)
    setBusy(true)
    const res = await callAction<{ status: 'confirmed' | 'waitlisted' }>('register', { sessionId: session.id })
    setBusy(false)
    if (!res.success) return toast.error('Could not register', res.error)
    if (res.data.status === 'waitlisted') toast.info('You’re on the waitlist', 'We’ll move you up if a seat opens.')
    else toast.success('You’re in!', session.data.title)
  }

  async function cancel() {
    if (!mine) return
    setBusy(true)
    const res = await callAction('cancel', { registrationId: mine.id })
    setBusy(false)
    setConfirmCancel(false)
    if (!res.success) return toast.error('Could not cancel', res.error)
    toast.success(mine.status === 'waitlisted' ? 'Left the waitlist' : 'Registration cancelled')
  }

  const time = formatTimeRange(session.data.startsAt, session.data.endsAt)

  return (
    <article
      data-testid="session-card"
      data-session-title={session.data.title}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-medium text-foreground">{session.data.title}</h3>
          {time && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {time}
            </span>
          )}
        </div>
        <CapacityBar occ={session.occ} className="max-w-md" />
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:w-56 sm:justify-end">
        {mine ? (
          <>
            <RegistrationBadge reg={mine} />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
              data-testid="cancel-button"
            >
              {mine.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel'}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant={session.occ.full ? 'outline' : 'default'}
            loading={busy}
            onClick={register}
            data-testid="register-button"
          >
            {session.occ.full ? 'Join waitlist' : 'Register'}
          </Button>
        )}
      </div>

      <ConfirmModal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        loading={busy}
        title={mine?.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel your registration?'}
        description={
          mine?.status === 'waitlisted'
            ? 'You’ll lose your place in line.'
            : 'Your seat will go to the next person on the waitlist.'
        }
        confirmText={mine?.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel registration'}
        cancelText="Keep it"
      />
      {showSignIn && <AuthOverlay onClose={() => setShowSignIn(false)} />}
    </article>
  )
}
