/**
 * Pure queue logic shared by the worker (server actions) and the UI.
 *
 * Every registration owns exactly one spot with a 1-based queue position in
 * its session. position <= capacity → confirmed; position > capacity →
 * waitlisted (waitlist order = position order). After any change the server
 * compacts positions back to 1..n, preserving order, so a cancellation lets
 * the head of the waitlist move up into the freed seat.
 */

export interface SpotLike {
  id: string
  position: number
  registrationId: string
}

export type RegistrationStatus = 'confirmed' | 'waitlisted'

export function statusFor(position: number, capacity: number): RegistrationStatus {
  return position <= capacity ? 'confirmed' : 'waitlisted'
}

/** Position a new registration should claim: one past the end of the queue. */
export function nextPosition(spots: Pick<SpotLike, 'position'>[]): number {
  return spots.reduce((max, s) => Math.max(max, s.position), 0) + 1
}

export interface Occupancy {
  confirmed: number
  waitlisted: number
  capacity: number
  full: boolean
}

export function occupancy(spots: Pick<SpotLike, 'position'>[], capacity: number): Occupancy {
  const confirmed = spots.filter((s) => s.position <= capacity).length
  return {
    confirmed,
    waitlisted: spots.length - confirmed,
    capacity,
    full: confirmed >= capacity,
  }
}

/** 1-based place in the waitlist for a spot, or null when confirmed. */
export function waitlistPlace(
  spots: Pick<SpotLike, 'position'>[],
  position: number,
  capacity: number,
): number | null {
  if (position <= capacity) return null
  return spots.filter((s) => s.position > capacity && s.position <= position).length
}

export interface Move {
  id: string
  from: number
  to: number
}

/**
 * Moves that compact the queue to positions 1..n in the current order.
 * Applying them in the returned order never collides with another spot:
 * the k-th smallest position is always >= k, and every slot below it has
 * already been finalized, so slot k is free when spot k moves into it.
 */
export function compactionMoves(spots: SpotLike[]): Move[] {
  const ordered = [...spots].sort((a, b) => a.position - b.position)
  const moves: Move[] = []
  ordered.forEach((spot, i) => {
    const to = i + 1
    if (spot.position !== to) moves.push({ id: spot.id, from: spot.position, to })
  })
  return moves
}

/**
 * Lowest capacity a session may be set to without demoting anyone who is
 * already confirmed.
 */
export function minimumCapacity(spots: Pick<SpotLike, 'position'>[], currentCapacity: number): number {
  return Math.max(1, occupancy(spots, currentCapacity).confirmed)
}
