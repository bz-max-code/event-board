/**
 * The board — every event and its sessions with live capacity bars.
 * Dynamic but not gated: signed-out visitors can browse; registering opens
 * the sign-in overlay.
 */

import { CalendarDays, MapPin } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { SessionCard } from '@/components/SessionCard'
import { useBoard } from '@/hooks/useBoard'
import { formatDate } from '@/lib/format'

export default function BoardPage() {
  const board = useBoard()

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Upcoming</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Events</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Pick a session to save your seat. Seat counts update live as people sign up. If a session is
          full, join the waitlist and you’ll move up automatically when someone cancels.
        </p>
      </header>

      {!board.ready ? (
        <BoardSkeleton />
      ) : board.events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="No events yet"
          description="Organizers haven’t published any events. Check back soon."
        />
      ) : (
        <div className="space-y-12">
          {board.events.map((event) => {
            const sessions = board.sessionsByEvent.get(event.recordId) ?? []
            return (
              <section key={event.recordId} data-testid="event-section" aria-labelledby={`ev-${event.recordId}`}>
                <div className="mb-4 border-b border-border pb-3">
                  <h2 id={`ev-${event.recordId}`} className="text-xl font-semibold text-foreground">
                    {event.data.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {event.data.date && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="size-4" aria-hidden />
                        {formatDate(event.data.date)}
                      </span>
                    )}
                    {event.data.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" aria-hidden />
                        {event.data.location}
                      </span>
                    )}
                  </div>
                  {event.data.description && (
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{event.data.description}</p>
                  )}
                </div>
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sessions will be announced soon.</p>
                ) : (
                  <div className="space-y-3">
                    {sessions.map((s) => (
                      <SessionCard key={s.id} session={s} mine={board.mineBySession.get(s.id)} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
      ))}
    </div>
  )
}
