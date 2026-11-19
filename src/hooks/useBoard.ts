import { useMemo } from 'react'
import { useAuth, useQuery } from 'deepspace'
import type { EventRow, RegistrationRow, SessionRow, SpotRow } from '@/lib/event-types'
import { occupancy, statusFor, waitlistPlace, type Occupancy, type RegistrationStatus } from '@/lib/queue'

type Rec<T> = { recordId: string; data: T; createdAt: string }

export interface SessionView {
  id: string
  data: SessionRow
  occ: Occupancy
  spots: SpotRow[]
}

export interface MyRegistration {
  id: string
  data: RegistrationRow
  /** null while the server is still assigning a queue position */
  status: RegistrationStatus | null
  waitlistPlace: number | null
}

/**
 * Live view of the board. Every collection is a realtime subscription, so
 * capacity bars and statuses update the moment any guest registers/cancels.
 *
 * `registrations` is RBAC-filtered by the server: guests receive only their
 * own rows, organizers receive everyone's. `mine` is filtered to the caller
 * either way.
 */
export function useBoard() {
  const { userId } = useAuth()
  const events = useQuery<EventRow>('events', { orderBy: 'date', orderDir: 'asc' })
  const sessions = useQuery<SessionRow>('sessions', { orderBy: 'startsAt', orderDir: 'asc' })
  const spots = useQuery<SpotRow>('spots')
  const registrations = useQuery<RegistrationRow>('registrations')

  return useMemo(() => {
    const spotsBySession = new Map<string, SpotRow[]>()
    for (const s of spots.records) {
      const list = spotsBySession.get(s.data.sessionId) ?? []
      list.push(s.data)
      spotsBySession.set(s.data.sessionId, list)
    }
    const spotByRegistration = new Map(spots.records.map((s) => [s.data.registrationId, s.data]))

    const sessionViews = new Map<string, SessionView>()
    const sessionsByEvent = new Map<string, SessionView[]>()
    for (const s of sessions.records) {
      const list = spotsBySession.get(s.recordId) ?? []
      const view: SessionView = { id: s.recordId, data: s.data, spots: list, occ: occupancy(list, s.data.capacity) }
      sessionViews.set(s.recordId, view)
      const byEvent = sessionsByEvent.get(s.data.eventId) ?? []
      byEvent.push(view)
      sessionsByEvent.set(s.data.eventId, byEvent)
    }

    const statusOf = (registrationId: string, sessionId: string) => {
      const spot = spotByRegistration.get(registrationId)
      const session = sessionViews.get(sessionId)
      if (!spot || !session) return { status: null, waitlistPlace: null }
      return {
        status: statusFor(spot.position, session.data.capacity),
        waitlistPlace: waitlistPlace(session.spots, spot.position, session.data.capacity),
      }
    }

    const all = (registrations.records as Rec<RegistrationRow>[]).map((r) => ({
      id: r.recordId,
      data: r.data,
      createdAt: r.createdAt,
      ...statusOf(r.recordId, r.data.sessionId),
    }))
    const mine: MyRegistration[] = all.filter((r) => r.data.userId === userId)
    const mineBySession = new Map(mine.map((r) => [r.data.sessionId, r]))

    return {
      ready:
        events.status !== 'loading' && sessions.status !== 'loading' && spots.status !== 'loading',
      events: events.records,
      eventsById: new Map(events.records.map((e) => [e.recordId, e])),
      sessionsByEvent,
      sessionViews,
      registrations: all,
      mine,
      mineBySession,
    }
  }, [events, sessions, spots, registrations, userId])
}
