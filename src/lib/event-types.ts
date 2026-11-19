/** Row shapes for the event board collections (fields live under `record.data`). */

export interface EventRow {
  title: string
  description?: string
  location?: string
  date?: string
}

export interface SessionRow {
  eventId: string
  title: string
  startsAt?: string | null
  endsAt?: string | null
  capacity: number
}

export interface RegistrationRow {
  sessionId: string
  eventId: string
  userId: string
  checkedInAt?: string | null
  checkedInBy?: string | null
}

export interface SpotRow {
  sessionId: string
  position: number
  registrationId: string
}
