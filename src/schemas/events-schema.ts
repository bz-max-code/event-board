/**
 * Event check-in board — collections.
 *
 * Roles: organizer = `admin`, guest = `member` (the default for every new
 * signed-in user). The app owner is always `admin`.
 *
 * Source of truth for capacity is `spots`: one row per registration holding
 * its queue position in the session. position <= session.capacity means
 * confirmed, anything above is waitlisted. `uniqueOn: ['sessionId','position']`
 * makes claiming a position atomic, so two concurrent registrations can never
 * take the same seat. Spots carry no user identity (they are written under the
 * app owner's identity by server actions), so every visitor can read them to
 * draw live capacity bars without learning who registered.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const closed: RolePermissions = { read: false, create: false, update: false, delete: false }
const readOnly: RolePermissions = { read: true, create: false, update: false, delete: false }

export const eventsSchema: CollectionSchema = {
  name: 'events',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'description', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'location', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'date', storage: 'text', interpretation: { kind: 'date' } },
  ],
  permissions: {
    '*': readOnly,
    viewer: readOnly,
    member: readOnly,
    // Deletion goes through the deleteEvent action so it can refuse an event
    // that still has sessions.
    admin: { read: true, create: true, update: true, delete: false },
  },
}

export const sessionsSchema: CollectionSchema = {
  name: 'sessions',
  columns: [
    { name: 'eventId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startsAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'endsAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'capacity', storage: 'number', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': readOnly,
    viewer: readOnly,
    member: readOnly,
    // All writes go through server actions: capacity changes must re-settle
    // the queue and may not drop below the confirmed count.
    admin: readOnly,
  },
}

export const registrationsSchema: CollectionSchema = {
  name: 'registrations',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'eventId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'checkedInAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'checkedInBy', storage: 'text', interpretation: 'plain' },
  ],
  // One registration per guest per session, enforced in the Durable Object.
  uniqueOn: ['sessionId', 'userId'],
  ownerField: 'userId',
  permissions: {
    '*': closed,
    viewer: closed,
    // Guests see only their own rows; register/cancel go through actions so
    // the spot queue stays consistent.
    member: { read: 'own', create: false, update: false, delete: false },
    admin: readOnly,
  },
}

export const spotsSchema: CollectionSchema = {
  name: 'spots',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'position', storage: 'number', interpretation: 'plain', required: true },
    { name: 'registrationId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  uniqueOn: ['sessionId', 'position'],
  permissions: {
    '*': readOnly,
    viewer: readOnly,
    member: readOnly,
    admin: readOnly,
  },
}

export const eventBoardSchemas = [eventsSchema, sessionsSchema, registrationsSchema, spotsSchema]
