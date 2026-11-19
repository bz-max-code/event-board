import type { Page } from '@playwright/test'
import { loadAllTestAccounts } from 'deepspace/testing'

/**
 * Test account names this suite expects in the local pool
 * (`npx deepspace test accounts list`). The organizer account must be
 * promoted ONCE by the app owner on /people — there is deliberately no
 * backdoor for it. Specs that need an organizer skip until that's done.
 */
export const ORGANIZER = 'Organizer'
export const GUEST_A = 'Guest A'
export const GUEST_B = 'Guest B'

export function hasAccounts(...names: string[]): boolean {
  const pool = new Set(loadAllTestAccounts().map((a) => a.name))
  return names.every((n) => pool.has(n))
}

export const missingAccountsMessage = (...names: string[]) =>
  `Needs test accounts named ${names.map((n) => `"${n}"`).join(', ')}. ` +
  'Create them with `npx deepspace test accounts create --email <x>@deepspace.test --name "<Name>" --password-stdin`.'

export type ActionResult<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string }

/** Call a server action as the user signed in on `page` (page must be on the app origin). */
export async function actionAs<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResult<T>> {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      const { token } = (await t.json()) as { token?: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  ) as Promise<ActionResult<T>>
}

/** True when the page's user is an organizer (admin). Probes an organizer-only action. */
export async function isOrganizer(page: Page): Promise<boolean> {
  // Wait for the signed-in shell first: the users row (what /people lists)
  // is created when the records socket connects, so a skip must not race it.
  await page.getByTestId('nav-user-name').waitFor({ timeout: 20_000 })
  const r = await actionAs(page, 'createSession', {})
  return !(r.success === false && /Only organizers/.test(r.error))
}

export const testTitle = (label: string) => `__test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}__ ${label}`

/** Organizer creates an event through the Manage UI; returns its id. */
export async function createEventViaUi(page: Page, title: string): Promise<string> {
  await page.goto('/manage')
  await page.getByTestId('new-event').click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Save event' }).click()
  const section = page.locator(`[data-testid="manage-event"][data-event-title="${title}"]`)
  await section.waitFor({ timeout: 15_000 })
  const id = await section.getAttribute('data-event-id')
  if (!id) throw new Error('event id missing')
  return id
}

export async function createSession(page: Page, eventId: string, title: string, capacity: number): Promise<string> {
  const r = await actionAs<{ sessionId: string }>(page, 'createSession', { eventId, title, capacity })
  if (!r.success) throw new Error(`createSession failed: ${r.error}`)
  return r.data.sessionId
}

/**
 * Remove everything a test created. Runs as the organizer: cancels any
 * registrations (via the dashboard data the organizer can read), then deletes
 * sessions and the event. Best effort — never throws.
 */
export async function cleanupEvent(page: Page, eventId: string, sessionIds: string[], registrationIds: string[]) {
  for (const id of registrationIds) await actionAs(page, 'cancel', { registrationId: id }).catch(() => {})
  for (const id of sessionIds) await actionAs(page, 'deleteSession', { sessionId: id }).catch(() => {})
  await actionAs(page, 'deleteEvent', { eventId }).catch(() => {})
}

export function sessionCard(page: Page, title: string) {
  return page.locator(`[data-testid="session-card"][data-session-title="${title}"]`).first()
}

/** Registration ids for a session, read from the organizer dashboard. */
export async function registrationIdsOnDashboard(page: Page, sessionTitle: string): Promise<string[]> {
  await page.goto('/organizer')
  await page.getByTestId('totals').waitFor({ timeout: 15_000 })
  const rows = page.locator('[data-testid="registration-row"]').filter({ hasText: sessionTitle })
  const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-registration-id') ?? ''))
  return ids.filter(Boolean)
}
