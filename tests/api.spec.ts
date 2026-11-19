import { test, expect } from 'deepspace/testing'
import {
  GUEST_A,
  GUEST_B,
  ORGANIZER,
  actionAs,
  cleanupEvent,
  createEventViaUi,
  createSession,
  hasAccounts,
  isOrganizer,
  missingAccountsMessage,
  testTitle,
} from './helpers/board'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket.
    await page.goto('/home')
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
  })

  for (const name of ['register', 'cancel', 'setCheckIn', 'createSession', 'updateSession', 'deleteEvent']) {
    test(`action ${name} requires sign-in`, async ({ request }) => {
      const res = await request.post(`/api/actions/${name}`, { data: {} })
      expect(res.status()).toBe(401)
    })
  }
})

test.describe('guest permissions', () => {
  test.skip(!hasAccounts(GUEST_A), missingAccountsMessage(GUEST_A))

  test('a guest cannot run organizer actions', async ({ users }) => {
    const [guest] = await users([GUEST_A])
    await guest.page.goto('/home')
    for (const [name, params] of [
      ['createSession', { eventId: 'x', title: 'x', capacity: 5 }],
      ['updateSession', { sessionId: 'x', capacity: 5 }],
      ['deleteSession', { sessionId: 'x' }],
      ['deleteEvent', { eventId: 'x' }],
      ['setCheckIn', { registrationId: 'x' }],
    ] as const) {
      const r = await actionAs(guest.page, name, params)
      expect(r, name).toMatchObject({ success: false, error: expect.stringMatching(/Only organizers/) })
    }
  })
})

test.describe('registration rules', () => {
  test.skip(!hasAccounts(ORGANIZER, GUEST_A, GUEST_B), missingAccountsMessage(ORGANIZER, GUEST_A, GUEST_B))

  test('duplicates, ownership, races, check-in and capacity rules', async ({ users }) => {
    const [org, a, b] = await users([ORGANIZER, GUEST_A, GUEST_B])
    await Promise.all([org.page.goto('/home'), a.page.goto('/home'), b.page.goto('/home')])
    test.skip(!(await isOrganizer(org.page)), `Promote "${ORGANIZER}" to organizer once on /people (signed in as the app owner).`)

    const eventId = await createEventViaUi(org.page, testTitle('API event'))
    const sessionId = await createSession(org.page, eventId, testTitle('API session'), 1)
    const regIds: string[] = []
    try {
      // Race for the last seat: exactly one confirmed, one waitlisted.
      const [ra, rb] = await Promise.all([
        actionAs<{ registrationId: string; status: string }>(a.page, 'register', { sessionId }),
        actionAs<{ registrationId: string; status: string }>(b.page, 'register', { sessionId }),
      ])
      expect(ra.success && rb.success).toBe(true)
      if (!ra.success || !rb.success) return
      regIds.push(ra.data.registrationId, rb.data.registrationId)
      expect([ra.data.status, rb.data.status].sort()).toEqual(['confirmed', 'waitlisted'])
      const [confirmed, waitlisted] = ra.data.status === 'confirmed' ? [ra, rb] : [rb, ra]
      const [confirmedUser, waitlistedUser] = ra.data.status === 'confirmed' ? [a, b] : [b, a]

      // Duplicate registration is refused (uniqueOn sessionId+userId).
      const dup = await actionAs(confirmedUser.page, 'register', { sessionId })
      expect(dup).toMatchObject({ success: false, error: expect.stringMatching(/already registered/) })

      // A guest cannot cancel someone else's registration.
      const steal = await actionAs(waitlistedUser.page, 'cancel', { registrationId: confirmed.data.registrationId })
      expect(steal).toMatchObject({ success: false, error: 'Registration not found' })

      // Waitlisted guests can't be checked in; confirmed ones can.
      const wCheck = await actionAs(org.page, 'setCheckIn', { registrationId: waitlisted.data.registrationId })
      expect(wCheck).toMatchObject({ success: false, error: expect.stringMatching(/confirmed/) })
      const cCheck = await actionAs(org.page, 'setCheckIn', { registrationId: confirmed.data.registrationId })
      expect(cCheck).toMatchObject({ success: true })

      // Capacity can't drop below the confirmed count; raising it promotes the waitlist.
      const shrink = await actionAs(org.page, 'updateSession', { sessionId, capacity: 0 })
      expect(shrink.success).toBe(false)
      const grow = await actionAs(org.page, 'updateSession', { sessionId, capacity: 2 })
      expect(grow).toMatchObject({ success: true })
      const wCheck2 = await actionAs(org.page, 'setCheckIn', { registrationId: waitlisted.data.registrationId })
      expect(wCheck2).toMatchObject({ success: true })

      // A session with registrations can't be deleted.
      const del = await actionAs(org.page, 'deleteSession', { sessionId })
      expect(del.success).toBe(false)

      // Owner can cancel their own registration.
      const own = await actionAs(confirmedUser.page, 'cancel', { registrationId: confirmed.data.registrationId })
      expect(own).toMatchObject({ success: true })
    } finally {
      await cleanupEvent(org.page, eventId, [sessionId], regIds)
    }
  })
})
