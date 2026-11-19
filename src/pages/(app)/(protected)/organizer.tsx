/**
 * Organizer dashboard — every registration across events, with live counts,
 * filters, search, and check-in. Organizers (`admin`) receive all
 * `registrations` rows from the server; guests receive only their own and are
 * shown the OrganizerOnly notice.
 */

import { useMemo, useState } from 'react'
import { useUserLookup } from 'deepspace'
import { Check, ClipboardList, Undo2, X } from 'lucide-react'
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import { OrganizerOnly } from '@/components/OrganizerOnly'
import { CapacityBar } from '@/components/CapacityBar'
import { useBoard } from '@/hooks/useBoard'
import { callAction } from '@/lib/actions'
import { formatTimeRange } from '@/lib/format'

type StatusFilter = 'all' | 'confirmed' | 'waitlisted' | 'checked-in'

export default function OrganizerPage() {
  return (
    <OrganizerOnly>
      <Dashboard />
    </OrganizerOnly>
  )
}

function Dashboard() {
  const board = useBoard()
  const lookup = useUserLookup()
  const toast = useToast()
  const [eventId, setEventId] = useState<string>('all')
  const [sessionId, setSessionId] = useState<string>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const sessionsForEvent = useMemo(
    () => (eventId === 'all' ? [] : (board.sessionsByEvent.get(eventId) ?? [])),
    [board.sessionsByEvent, eventId],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return board.registrations
      .filter((r) => eventId === 'all' || r.data.eventId === eventId)
      .filter((r) => sessionId === 'all' || r.data.sessionId === sessionId)
      .filter((r) => {
        if (status === 'all') return true
        if (status === 'checked-in') return !!r.data.checkedInAt
        return r.status === status
      })
      .map((r) => ({
        ...r,
        name: lookup.getName(r.data.userId) ?? 'Unknown guest',
        email: lookup.getEmail(r.data.userId) ?? '',
        session: board.sessionViews.get(r.data.sessionId),
        event: board.eventsById.get(r.data.eventId),
      }))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const s = (a.session?.data.title ?? '').localeCompare(b.session?.data.title ?? '')
        if (s !== 0) return s
        // confirmed first, then waitlist in queue order
        const pa = a.session?.spots.find((x) => x.registrationId === a.id)?.position ?? Infinity
        const pb = b.session?.spots.find((x) => x.registrationId === b.id)?.position ?? Infinity
        return pa - pb
      })
  }, [board, lookup, eventId, sessionId, status, query])

  const totals = useMemo(() => {
    const scoped = board.registrations.filter(
      (r) => (eventId === 'all' || r.data.eventId === eventId) && (sessionId === 'all' || r.data.sessionId === sessionId),
    )
    return {
      confirmed: scoped.filter((r) => r.status === 'confirmed').length,
      waitlisted: scoped.filter((r) => r.status === 'waitlisted').length,
      checkedIn: scoped.filter((r) => r.data.checkedInAt).length,
    }
  }, [board.registrations, eventId, sessionId])

  async function setCheckIn(id: string, checkedIn: boolean) {
    setBusyId(id)
    const res = await callAction('setCheckIn', { registrationId: id, checkedIn })
    setBusyId(null)
    if (!res.success) toast.error('Check-in failed', res.error)
  }

  async function cancel() {
    if (!cancelId) return
    setBusyId(cancelId)
    const res = await callAction('cancel', { registrationId: cancelId })
    setBusyId(null)
    setCancelId(null)
    if (!res.success) toast.error('Could not remove registration', res.error)
  }

  const sessionsInScope =
    eventId === 'all'
      ? [...board.sessionViews.values()]
      : sessionId === 'all'
        ? sessionsForEvent
        : sessionsForEvent.filter((s) => s.id === sessionId)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Organizer</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Check-in dashboard</h1>
      </header>

      <div className="mb-8 grid grid-cols-3 gap-3" data-testid="totals">
        <Stat label="Confirmed" value={totals.confirmed} testId="total-confirmed" />
        <Stat label="Waitlisted" value={totals.waitlisted} testId="total-waitlisted" />
        <Stat
          label="Checked in"
          value={totals.checkedIn}
          suffix={totals.confirmed ? ` / ${totals.confirmed}` : ''}
          testId="total-checked-in"
        />
      </div>

      {sessionsInScope.length > 0 && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sessionsInScope.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <p className="truncate text-sm font-medium text-foreground">{s.data.title}</p>
              <p className="mb-3 truncate text-xs text-muted-foreground">
                {board.eventsById.get(s.data.eventId)?.data.title}
              </p>
              <CapacityBar occ={s.occ} />
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guest name or email"
          className="sm:max-w-xs"
          aria-label="Search guests"
        />
        <Select
          value={eventId}
          onValueChange={(v) => {
            setEventId(String(v))
            setSessionId('all')
          }}
        >
          <SelectTrigger className="sm:w-48" aria-label="Filter by event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {board.events.map((e) => (
              <SelectItem key={e.recordId} value={e.recordId}>
                {e.data.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sessionId} onValueChange={(v) => setSessionId(String(v))} disabled={eventId === 'all'}>
          <SelectTrigger className="sm:w-48" aria-label="Filter by session">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sessions</SelectItem>
            {sessionsForEvent.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.data.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="waitlisted">Waitlisted</SelectItem>
            <SelectItem value="checked-in">Checked in</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={board.registrations.length === 0 ? 'No registrations yet' : 'No matches'}
          description={
            board.registrations.length === 0
              ? 'Registrations appear here live as guests sign up.'
              : 'Try a different filter or search.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm" data-testid="registrations-table">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Guest</th>
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Check-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} data-testid="registration-row" data-guest-email={r.email} data-registration-id={r.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{r.session?.data.title ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.event?.data.title}
                      {r.session?.data.startsAt
                        ? ` · ${formatTimeRange(r.session.data.startsAt, r.session.data.endsAt)}`
                        : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3" data-testid="row-status">
                    {r.data.checkedInAt ? (
                      <Badge variant="info">Checked in</Badge>
                    ) : r.status === 'confirmed' ? (
                      <Badge variant="success">Confirmed</Badge>
                    ) : r.status === 'waitlisted' ? (
                      <Badge variant="warning">Waitlist #{r.waitlistPlace}</Badge>
                    ) : (
                      <Badge variant="secondary">Processing…</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {r.data.checkedInAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => setCheckIn(r.id, false)}
                          data-testid="undo-check-in"
                        >
                          <Undo2 aria-hidden /> Undo
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === r.id || r.status !== 'confirmed'}
                          onClick={() => setCheckIn(r.id, true)}
                          data-testid="check-in"
                          title={r.status !== 'confirmed' ? 'Only confirmed guests can be checked in' : undefined}
                        >
                          <Check aria-hidden /> Check in
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9"
                        aria-label={`Remove ${r.name}`}
                        disabled={busyId === r.id}
                        onClick={() => setCancelId(r.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        onConfirm={cancel}
        loading={!!cancelId && busyId === cancelId}
        title="Remove this registration?"
        description="The guest loses their seat (or waitlist place) and the next person in line moves up."
        confirmText="Remove"
      />
    </div>
  )
}

function Stat({ label, value, suffix = '', testId }: { label: string; value: number; suffix?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground" data-testid={testId}>
        {value}
        <span className="text-base font-normal text-muted-foreground">{suffix}</span>
      </p>
    </div>
  )
}
