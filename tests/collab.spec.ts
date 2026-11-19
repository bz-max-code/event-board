/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import {
  GUEST_A,
  GUEST_B,
  ORGANIZER,
  actionAs,
  registrationIdsOnDashboard,
  cleanupEvent,
  createEventViaUi,
  createSession,
  hasAccounts,
  isOrganizer,
  missingAccountsMessage,
  sessionCard,
  testTitle,
} from './helpers/board'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

// ── Event board: live capacity, waitlist promotion, privacy, check-in ──────


test.describe('event board (3 users)', () => {
  test.skip(!hasAccounts(ORGANIZER, GUEST_A, GUEST_B), missingAccountsMessage(ORGANIZER, GUEST_A, GUEST_B))

  test('capacity updates live, waitlist promotes on cancel, organizer checks in', async ({ users }) => {
    test.setTimeout(120_000)
    const [org, a, b] = await users([ORGANIZER, GUEST_A, GUEST_B])
    await org.page.goto('/home')
    test.skip(!(await isOrganizer(org.page)), `Promote "${ORGANIZER}" to organizer once on /people (signed in as the app owner).`)

    // Organizer creates an event (via the Manage UI) with a 1-seat session.
    const eventTitle = testTitle('Collab event')
    const sessionTitle = testTitle('Tiny room')
    const eventId = await createEventViaUi(org.page, eventTitle)
    const sessionId = await createSession(org.page, eventId, sessionTitle, 1)
    const regIds: string[] = []

    try {
      await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
      const cardA = sessionCard(a.page, sessionTitle)
      const cardB = sessionCard(b.page, sessionTitle)
      await expect(cardA.getByTestId('capacity-count')).toHaveText(/0\s*\/\s*1 seats/, { timeout: 15_000 })
      await expect(cardB.getByTestId('capacity-count')).toHaveText(/0\s*\/\s*1 seats/)

      // A registers → B's bar fills live and B is offered the waitlist.
      await cardA.getByTestId('register-button').click()
      await expect(cardA.getByTestId('my-status')).toHaveText('Registered', { timeout: 15_000 })
      await expect(cardB.getByTestId('capacity-count')).toHaveText(/1\s*\/\s*1 seats/, { timeout: 15_000 })
      await expect(cardB.getByTestId('register-button')).toHaveText('Join waitlist')

      // B joins the waitlist → A sees the waitlist count live.
      await cardB.getByTestId('register-button').click()
      await expect(cardB.getByTestId('my-status')).toHaveText('Waitlist #1', { timeout: 15_000 })
      await expect(cardA.getByTestId('capacity-status')).toHaveText('Full · 1 on waitlist', { timeout: 15_000 })

      // Privacy: B's list shows only B's own registration for this session (A holds
      // the other one), and B can't open the dashboard. Scoped to this test's
      // session so leftover registrations from manual testing don't matter.
      await b.page.goto('/my-registrations')
      const bCards = b.page
        .locator('[data-testid="my-registrations"] [data-testid="session-card"]')
        .filter({ hasText: sessionTitle })
      await expect(bCards).toHaveCount(1, { timeout: 15_000 })
      await expect(bCards.getByTestId('my-status')).toHaveText('Waitlist #1')
      await b.page.goto('/organizer')
      await expect(b.page.getByTestId('organizers-only')).toBeVisible({ timeout: 15_000 })

      // Organizer dashboard lists both guests; waitlisted guest can't be checked in.
      await org.page.goto('/organizer')
      const rowA = org.page.locator(`[data-testid="registration-row"][data-guest-email="${a.email}"]`).filter({ hasText: sessionTitle })
      const rowB = org.page.locator(`[data-testid="registration-row"][data-guest-email="${b.email}"]`).filter({ hasText: sessionTitle })
      await expect(rowA.getByTestId('row-status')).toHaveText('Confirmed', { timeout: 15_000 })
      await expect(rowB.getByTestId('row-status')).toHaveText('Waitlist #1')
      await expect(rowB.getByTestId('check-in')).toBeDisabled()

      // Check A in → A sees it on their own card.
      await rowA.getByTestId('check-in').click()
      await expect(rowA.getByTestId('row-status')).toHaveText('Checked in', { timeout: 15_000 })
      await expect(cardA.getByTestId('my-status')).toHaveText('Checked in', { timeout: 15_000 })

      // A cancels → B is promoted live, on B's page and on the dashboard.
      await b.page.goto('/home')
      const cardB2 = sessionCard(b.page, sessionTitle)
      await expect(cardB2.getByTestId('my-status')).toHaveText('Waitlist #1', { timeout: 15_000 })
      await cardA.getByTestId('cancel-button').click()
      await a.page.getByRole('button', { name: 'Cancel registration' }).click()
      await expect(cardA.getByTestId('register-button')).toBeVisible({ timeout: 15_000 })
      await expect(cardB2.getByTestId('my-status')).toHaveText('Registered', { timeout: 15_000 })
      await expect(rowB.getByTestId('row-status')).toHaveText('Confirmed', { timeout: 15_000 })
      await expect(rowA).toHaveCount(0)

      // Duplicate guard holds for the promoted guest too.
      const dup = await actionAs(b.page, 'register', { sessionId })
      expect(dup).toMatchObject({ success: false, error: expect.stringMatching(/already registered/) })
    } finally {
      regIds.push(...(await registrationIdsOnDashboard(org.page, sessionTitle).catch(() => [])))
      await cleanupEvent(org.page, eventId, [sessionId], regIds)
    }
  })
})
