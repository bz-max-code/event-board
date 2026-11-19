import { describe, expect, it } from 'vitest'
import {
  compactionMoves,
  minimumCapacity,
  nextPosition,
  occupancy,
  statusFor,
  waitlistPlace,
  type SpotLike,
} from './queue'

const spot = (id: string, position: number): SpotLike => ({ id, position, registrationId: `r-${id}` })

describe('queue', () => {
  it('derives status from position and capacity', () => {
    expect(statusFor(1, 2)).toBe('confirmed')
    expect(statusFor(2, 2)).toBe('confirmed')
    expect(statusFor(3, 2)).toBe('waitlisted')
  })

  it('claims one past the end of the queue', () => {
    expect(nextPosition([])).toBe(1)
    expect(nextPosition([spot('a', 1), spot('b', 4)])).toBe(5)
  })

  it('counts confirmed and waitlisted', () => {
    const spots = [spot('a', 1), spot('b', 2), spot('c', 3)]
    expect(occupancy(spots, 2)).toEqual({ confirmed: 2, waitlisted: 1, capacity: 2, full: true })
    expect(occupancy(spots, 5)).toEqual({ confirmed: 3, waitlisted: 0, capacity: 5, full: false })
  })

  it('reports waitlist place', () => {
    const spots = [spot('a', 1), spot('b', 2), spot('c', 3), spot('d', 4)]
    expect(waitlistPlace(spots, 2, 2)).toBeNull()
    expect(waitlistPlace(spots, 3, 2)).toBe(1)
    expect(waitlistPlace(spots, 4, 2)).toBe(2)
  })

  it('compacts after a cancellation, promoting the waitlist head', () => {
    // capacity 2: a(1) cancelled → b(2), c(3, waitlisted), d(4)
    const spots = [spot('d', 4), spot('b', 2), spot('c', 3)]
    const moves = compactionMoves(spots)
    expect(moves).toEqual([
      { id: 'b', from: 2, to: 1 },
      { id: 'c', from: 3, to: 2 },
      { id: 'd', from: 4, to: 3 },
    ])
    // c moved into position 2 → now confirmed under capacity 2
    expect(statusFor(2, 2)).toBe('confirmed')
  })

  it('never moves a spot onto an occupied position', () => {
    const spots = [spot('a', 1), spot('b', 5), spot('c', 3), spot('d', 9)]
    const taken = new Map(spots.map((s) => [s.position, s.id]))
    for (const m of compactionMoves(spots)) {
      expect(taken.get(m.to) === undefined || taken.get(m.to) === m.id).toBe(true)
      taken.delete(m.from)
      taken.set(m.to, m.id)
    }
    expect([...taken.keys()].sort()).toEqual([1, 2, 3, 4])
  })

  it('is a no-op on an already compact queue', () => {
    expect(compactionMoves([spot('a', 1), spot('b', 2)])).toEqual([])
  })

  it('will not let capacity drop below the confirmed count', () => {
    const spots = [spot('a', 1), spot('b', 2), spot('c', 3)]
    expect(minimumCapacity(spots, 5)).toBe(3)
    expect(minimumCapacity(spots, 2)).toBe(2)
    expect(minimumCapacity([], 10)).toBe(1)
  })
})
