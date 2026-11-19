/**
 * Server actions for the event check-in board.
 *
 * Actions run with RBAC off (see src/server/action-routes.ts), so every
 * action here authorizes explicitly:
 *   - organizer actions require the caller's app role to be `admin`
 *   - guest actions act only on the caller's own registration (or an admin's)
 *
 * Capacity model: see src/lib/queue.ts. `spots` is the source of truth; the
 * `uniqueOn: ['sessionId','position']` constraint makes claiming a position
 * atomic, and `settleSession` compacts positions after every change so the
 * waitlist head moves into a freed seat.
 */

import { resolveAppRole } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { compactionMoves, minimumCapacity, nextPosition, statusFor } from '../lib/queue'
import { createActionTools } from '../server/action-tools'

// ── Types ──────────────────────────────────────────────────────────────────

interface Envelope<T> {
  recordId: string
  data: T
  createdBy?: string
}
interface EventRow {
  title: string
}
interface SessionRow {
  eventId: string
  title: string
  startsAt?: string
  endsAt?: string
  capacity: number
}
interface RegistrationRow {
  sessionId: string
  eventId: string
  userId: string
  checkedInAt?: string | null
  checkedInBy?: string | null
}
interface SpotRow {
  sessionId: string
  position: number
  registrationId: string
}

type Ctx = Parameters<ActionHandler<Env>>[0]

const MAX_CLAIM_ATTEMPTS = 8
const MAX_CAPACITY = 10_000

// ── Helpers ────────────────────────────────────────────────────────────────

const fail = (error: string): ActionResult<never> => ({ success: false, error })

async function getRecord<T>(tools: ActionTools, coll: string, id: string): Promise<Envelope<T> | null> {
  const r = await tools.get(coll, id)
  if (!r.success) return null
  return (r.data as { record?: Envelope<T> }).record ?? null
}

async function queryAll<T>(
  tools: ActionTools,
  coll: string,
  where: Record<string, string | number>,
): Promise<Envelope<T>[]> {
  const r = await tools.query(coll, { where })
  if (!r.success) throw new Error(r.error)
  return (r.data as { records: Envelope<T>[] }).records
}

function isDuplicate(result: ActionResult<unknown>): boolean {
  return !result.success && /^Duplicate/i.test(result.error ?? '')
}

async function isOrganizer(ctx: Ctx): Promise<boolean> {
  return (await resolveAppRole(ctx.env, ctx.userId)) === 'admin'
}

/**
 * Tools acting as the app owner. Spots are written with these so their
 * `createdBy` never identifies the guest — spots are publicly readable.
 */
function appTools(ctx: Ctx): ActionTools {
  return createActionTools(ctx.env, ctx.env.OWNER_USER_ID, ctx.callerJwt)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

function parseCapacity(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) return null
  return n
}

/** Claim the next queue position for a registration; retries on races. */
async function claimSpot(tools: ActionTools, sessionId: string, registrationId: string) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const spots = await queryAll<SpotRow>(tools, 'spots', { sessionId })
    const existing = spots.find((s) => s.data.registrationId === registrationId)
    if (existing) return existing.data.position
    const position = nextPosition(spots.map((s) => s.data))
    const created = await tools.create('spots', { sessionId, position, registrationId })
    if (created.success) return position
    if (!isDuplicate(created)) throw new Error(created.error)
    // Someone else took that position between our read and write — retry.
  }
  throw new Error('Session is busy, please try again')
}

/**
 * Bring a session's queue back to a consistent state:
 *   1. drop spots whose registration no longer exists, and duplicate spots
 *   2. give every registration without a spot one at the back of the queue
 *   3. compact positions to 1..n in order (promotes the waitlist head)
 * Idempotent and safe to run concurrently: a move refused by the uniqueness
 * constraint is skipped and the next settle finishes the job.
 */
async function settleSession(ctx: Ctx, sessionId: string): Promise<void> {
  const tools = appTools(ctx)
  const [spots, regs] = await Promise.all([
    queryAll<SpotRow>(tools, 'spots', { sessionId }),
    queryAll<RegistrationRow>(tools, 'registrations', { sessionId }),
  ])
  const regIds = new Set(regs.map((r) => r.recordId))
  const seen = new Set<string>()
  const keep: Envelope<SpotRow>[] = []
  for (const s of [...spots].sort((a, b) => a.data.position - b.data.position)) {
    if (!regIds.has(s.data.registrationId) || seen.has(s.data.registrationId)) {
      await tools.remove('spots', s.recordId)
      continue
    }
    seen.add(s.data.registrationId)
    keep.push(s)
  }
  for (const r of regs) {
    if (!seen.has(r.recordId)) await claimSpot(tools, sessionId, r.recordId)
  }
  const fresh = await queryAll<SpotRow>(tools, 'spots', { sessionId })
  const moves = compactionMoves(
    fresh.map((s) => ({ id: s.recordId, position: s.data.position, registrationId: s.data.registrationId })),
  )
  for (const m of moves) {
    const r = await tools.update('spots', m.id, { position: m.to })
    if (!r.success && !isDuplicate(r)) throw new Error(r.error)
  }
}

async function spotFor(ctx: Ctx, sessionId: string, registrationId: string) {
  const spots = await queryAll<SpotRow>(appTools(ctx), 'spots', { sessionId })
  return spots.find((s) => s.data.registrationId === registrationId) ?? null
}

// ── Actions ────────────────────────────────────────────────────────────────

export const actions: Record<string, ActionHandler<Env>> = {
  /** Organizer: create a session under an event. */
  async createSession(ctx) {
    if (!(await isOrganizer(ctx))) return fail('Only organizers can create sessions')
    const eventId = str(ctx.params.eventId)
    const title = str(ctx.params.title)
    const capacity = parseCapacity(ctx.params.capacity)
    if (!eventId || !title) return fail('eventId and title are required')
    if (capacity === null) return fail(`Capacity must be a whole number between 1 and ${MAX_CAPACITY}`)
    const event = await getRecord<EventRow>(ctx.tools, 'events', eventId)
    if (!event) return fail('Event not found')
    const created = await ctx.tools.create('sessions', {
      eventId,
      title,
      capacity,
      startsAt: str(ctx.params.startsAt) ?? null,
      endsAt: str(ctx.params.endsAt) ?? null,
    })
    if (!created.success) return created
    return { success: true, data: { sessionId: created.data.recordId } }
  },

  /** Organizer: edit a session. Capacity may not drop below the confirmed count. */
  async updateSession(ctx) {
    if (!(await isOrganizer(ctx))) return fail('Only organizers can edit sessions')
    const sessionId = str(ctx.params.sessionId)
    if (!sessionId) return fail('sessionId is required')
    const session = await getRecord<SessionRow>(ctx.tools, 'sessions', sessionId)
    if (!session) return fail('Session not found')

    const patch: Record<string, unknown> = {}
    const title = str(ctx.params.title)
    if (title) patch.title = title
    if ('startsAt' in ctx.params) patch.startsAt = str(ctx.params.startsAt) ?? null
    if ('endsAt' in ctx.params) patch.endsAt = str(ctx.params.endsAt) ?? null
    if ('capacity' in ctx.params) {
      const capacity = parseCapacity(ctx.params.capacity)
      if (capacity === null) return fail(`Capacity must be a whole number between 1 and ${MAX_CAPACITY}`)
      const spots = await queryAll<SpotRow>(appTools(ctx), 'spots', { sessionId })
      const min = minimumCapacity(spots.map((s) => s.data), session.data.capacity)
      if (capacity < min) {
        return fail(`Capacity can't go below ${min}: that many guests are already confirmed`)
      }
      patch.capacity = capacity
    }
    const updated = await ctx.tools.update('sessions', sessionId, patch)
    if (!updated.success) return updated
    // Raising capacity can promote waitlisted guests; settle re-derives positions.
    await settleSession(ctx, sessionId)
    return { success: true, data: { sessionId } }
  },

  /** Organizer: delete a session that has no registrations. */
  async deleteSession(ctx) {
    if (!(await isOrganizer(ctx))) return fail('Only organizers can delete sessions')
    const sessionId = str(ctx.params.sessionId)
    if (!sessionId) return fail('sessionId is required')
    const regs = await queryAll<RegistrationRow>(ctx.tools, 'registrations', { sessionId })
    if (regs.length > 0) return fail(`This session has ${regs.length} registration(s); it can't be deleted`)
    const removed = await ctx.tools.remove('sessions', sessionId)
    if (!removed.success) return removed
    return { success: true, data: { sessionId } }
  },

  /** Organizer: delete an event that has no sessions. */
  async deleteEvent(ctx) {
    if (!(await isOrganizer(ctx))) return fail('Only organizers can delete events')
    const eventId = str(ctx.params.eventId)
    if (!eventId) return fail('eventId is required')
    const sessions = await queryAll<SessionRow>(ctx.tools, 'sessions', { eventId })
    if (sessions.length > 0) return fail('Delete the event’s sessions first')
    const removed = await ctx.tools.remove('events', eventId)
    if (!removed.success) return removed
    return { success: true, data: { eventId } }
  },

  /**
   * Guest: register for a session. Joins the waitlist when the session is full.
   * Duplicate registrations are refused by `uniqueOn: ['sessionId','userId']`.
   */
  async register(ctx) {
    const role = await resolveAppRole(ctx.env, ctx.userId)
    if (role !== 'member' && role !== 'admin') return fail('Sign in to register')
    const sessionId = str(ctx.params.sessionId)
    if (!sessionId) return fail('sessionId is required')
    const session = await getRecord<SessionRow>(ctx.tools, 'sessions', sessionId)
    if (!session) return fail('Session not found')

    // Registration first, under the caller's identity (userBound stamps userId).
    const created = await ctx.tools.create('registrations', {
      sessionId,
      eventId: session.data.eventId,
      userId: ctx.userId,
    })
    if (isDuplicate(created)) return fail('You are already registered for this session')
    if (!created.success) return created
    const registrationId = created.data.recordId

    let position: number
    try {
      position = await claimSpot(appTools(ctx), sessionId, registrationId)
    } catch (err) {
      await ctx.tools.remove('registrations', registrationId)
      return fail(err instanceof Error ? err.message : 'Could not register')
    }
    await settleSession(ctx, sessionId)
    const spot = await spotFor(ctx, sessionId, registrationId)
    const finalPosition = spot?.data.position ?? position
    return {
      success: true,
      data: { registrationId, status: statusFor(finalPosition, session.data.capacity) },
    }
  },

  /** Guest (own registration) or organizer: cancel; promotes the waitlist head. */
  async cancel(ctx) {
    const registrationId = str(ctx.params.registrationId)
    if (!registrationId) return fail('registrationId is required')
    const reg = await getRecord<RegistrationRow>(ctx.tools, 'registrations', registrationId)
    if (!reg) return fail('Registration not found')
    if (reg.data.userId !== ctx.userId && !(await isOrganizer(ctx))) {
      // Same answer as "not found": don't confirm that someone else's id exists.
      return fail('Registration not found')
    }
    const tools = appTools(ctx)
    const spot = await spotFor(ctx, reg.data.sessionId, registrationId)
    if (spot) await tools.remove('spots', spot.recordId)
    const removed = await ctx.tools.remove('registrations', registrationId)
    if (!removed.success) return removed
    await settleSession(ctx, reg.data.sessionId)
    return { success: true, data: { registrationId } }
  },

  /** Organizer: check a confirmed guest in (or undo). */
  async setCheckIn(ctx) {
    if (!(await isOrganizer(ctx))) return fail('Only organizers can check guests in')
    const registrationId = str(ctx.params.registrationId)
    const checkedIn = ctx.params.checkedIn !== false
    if (!registrationId) return fail('registrationId is required')
    const reg = await getRecord<RegistrationRow>(ctx.tools, 'registrations', registrationId)
    if (!reg) return fail('Registration not found')
    if (checkedIn) {
      const [session, spot] = await Promise.all([
        getRecord<SessionRow>(ctx.tools, 'sessions', reg.data.sessionId),
        spotFor(ctx, reg.data.sessionId, registrationId),
      ])
      if (!session || !spot || statusFor(spot.data.position, session.data.capacity) !== 'confirmed') {
        return fail('Only confirmed guests can be checked in')
      }
    }
    const patch: Record<string, unknown> = checkedIn
      ? { checkedInAt: new Date().toISOString(), checkedInBy: ctx.userId }
      : { checkedInAt: null, checkedInBy: null }
    const updated = await ctx.tools.update('registrations', registrationId, patch)
    if (!updated.success) return updated
    return { success: true, data: { registrationId, checkedIn } }
  },
}
