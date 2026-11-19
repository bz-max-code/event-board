/**
 * The signed-in guest's own registrations. The server only sends a guest
 * their own rows (`registrations.member.read = 'own'`); useBoard().mine also
 * filters by userId so organizers see only their personal ones here.
 */

import { useNavigate } from 'react-router-dom'
import { Ticket } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { SessionCard } from '@/components/SessionCard'
import { useBoard } from '@/hooks/useBoard'
import { formatDate } from '@/lib/format'

export default function MyRegistrationsPage() {
  const board = useBoard()
  const navigate = useNavigate()

  const rows = board.mine
    .map((reg) => ({ reg, session: board.sessionViews.get(reg.data.sessionId) }))
    .filter((r) => r.session)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">My registrations</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Only you can see this list. Cancel anytime; your seat goes to the next person in line.
      </p>

      <div className="mt-8 space-y-3" data-testid="my-registrations">
        {!board.ready ? (
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" aria-busy="true" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Ticket />}
            title="You haven’t registered for anything yet"
            description="Browse events and save a seat."
            action={{ label: 'Browse events', onClick: () => navigate('/home') }}
          />
        ) : (
          rows.map(({ reg, session }) => {
            const event = board.eventsById.get(reg.data.eventId)
            return (
              <div key={reg.id} className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {event?.data.title}
                  {event?.data.date ? ` · ${formatDate(event.data.date)}` : ''}
                </p>
                <SessionCard session={session!} mine={reg} />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
