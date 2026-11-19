# Build log — Event check-in board

A short entry per build step: what was done, decisions/tradeoffs, and what was tested.

## Roles at a glance

| Role in the product | DeepSpace role | How someone gets it |
|---|---|---|
| Organizer | `admin` | The app owner is always `admin`. Any admin can promote another user on the **People** page (`useUsers().setRole`). The server refuses role changes from non-admins, and `users.role` is a protected column, so no one can promote themselves. |
| Guest | `member` | Default for every signed-in user. |
| Signed-out visitor | `viewer` / `*` | Can browse events and live capacity, must sign in to register. |

---

## Step 1 — Data model and permissions

**What:** Added `src/schemas/events-schema.ts` with four collections and registered them in `src/schemas.ts`:

- `events` — title, description, location, date. Everyone can read it. Admins can create and update it. Deletion goes through an action.
- `sessions` — eventId, title, startsAt/endsAt, capacity. Everyone can read it. All writes go through server actions.
- `registrations` — sessionId, eventId, userId (`userBound`, `immutable`), checkedInAt/By. `uniqueOn: ['sessionId','userId']` blocks duplicate registrations. `ownerField: 'userId'`, so guests read only their own (`read: 'own'`). Guests have no direct create/update/delete.
- `spots` — sessionId, position, registrationId. `uniqueOn: ['sessionId','position']`. Everyone can read it.

**Decisions / tradeoffs:**

- **No stored counters.** The first plan was to store `registeredCount` / `waitlistCount` on the session. Server actions are several separate round trips to the Durable Object, so two concurrent registrations could both read the same count and write back a stale value. Instead, **`spots` is the single source of truth**: one row per registration with its queue position. If position ≤ capacity the registration is confirmed; otherwise it is waitlisted. Claiming a position is atomic because of the uniqueness constraint, so overbooking is impossible even under races. Capacity bars count the spots.
- **Status is derived, not stored.** A registration has no `status` column, because a stored copy could drift from the spot positions. Both the UI and the actions derive status from the spot position and the session capacity.
- **Privacy of spots.** Spots are readable by everyone so capacity bars stay live. They carry no user data, and they will be written under the app's identity rather than the guest's, so the `createdBy` field doesn't reveal who registered.
- Only one `uniqueOn` constraint is allowed per collection. That is why the seat-locking lives in `spots` rather than on `registrations`.

**Tested:** Added a unit test that runs the SDK schema lint (`src/schemas.lint.test.ts`); it passes with zero warnings. `tsc --noEmit` is clean.

## Step 2 — Server actions and queue logic

**What:**
- `src/lib/queue.ts`: pure functions shared by the worker and the UI: `statusFor`, `nextPosition`, `occupancy`, `waitlistPlace`, `compactionMoves`, `minimumCapacity`.
- `src/actions/index.ts`: `register`, `cancel`, `setCheckIn`, `createSession`, `updateSession`, `deleteSession`, `deleteEvent`.
- Moved the scaffold's `createActionTools` into `src/server/action-tools.ts`, so actions can build a second tools instance that acts as the app owner.

**How registration works:**
1. Create the registration under the caller's identity. A duplicate is refused by `uniqueOn` and comes back as "already registered".
2. Claim `max(position)+1` in `spots`. If another request took that position first, the uniqueness constraint refuses the write and the action retries, up to 8 times.
3. Settle the session. Cancelling deletes the spot and the registration, then settles. Settling compacts positions to 1..n in order, so the waitlist head moves into the freed seat.

**Decisions / tradeoffs:**
- **Every action authorizes explicitly**, because actions bypass RBAC. Organizer actions check `resolveAppRole(...) === 'admin'`. `cancel` allows the registration's owner or an organizer. Someone else's id gets the same "not found" answer, so it doesn't confirm the id exists.
- **Settling is idempotent and self-healing.** It removes orphan or duplicate spots, gives a spot to any registration missing one, and compacts. If a concurrent request makes a move fail on the uniqueness constraint, the move is skipped and the next settle finishes it. The proof that compaction never collides is in the `compactionMoves` doc comment, and a unit test checks it.
- **Capacity can be lowered only down to the current confirmed count**, so no confirmed guest is ever bumped back to the waitlist. Raising capacity promotes waitlisted guests automatically.
- **Check-in is allowed only for confirmed guests** and can be undone.
- **Event and session deletion is refused while children exist.** This avoids silent cascades that would wipe registrations.
- **Known edge:** if a worker crashes between creating the registration and claiming its spot, the next settle on that session repairs it. Until then the guest's row shows "Processing…".

**Tested:** Unit tests in `src/lib/queue.test.ts` cover status derivation, occupancy, waitlist place, compaction (including a no-collision property check) and the capacity floor (8 tests). The whole unit suite passes, 12/12. `tsc` and `eslint` are clean. The action endpoints get Playwright API tests in step 6, once the dev server runs.

## Step 3 — Guest UI

**What:**
- `src/hooks/useBoard.ts`: one hook that subscribes to `events`, `sessions`, `spots` and `registrations` and works out each session's occupancy and the caller's own registrations with their status.
- `src/components/CapacityBar.tsx`: an accessible meter (`role="meter"`) showing seats taken / capacity, seats left or the waitlist length. Its colour moves from open → nearly full (≥75%) → full.
- `src/components/SessionCard.tsx`: a session row with the capacity bar and the caller's control: **Register**, or **Join waitlist** when full. Once registered it shows a **Registered / Waitlist #n / Checked in** badge with a **Cancel / Leave waitlist** button (with a confirm dialog). Signed-out visitors get the sign-in overlay when they try to register.
- `/home` is now the events board. It stays under `(app)/` but not `(protected)/`, so signed-out visitors can browse it.
- `/my-registrations` (sign-in required) lists the caller's own registrations.
- `src/lib/actions.ts` is a small client wrapper for `POST /api/actions/:name` with the user's JWT. Nav entries were added.

**Decisions / tradeoffs:**
- **No optimistic UI.** After an action the UI waits for the realtime broadcast. The server decides confirmed vs waitlisted, so showing a guess first could flash the wrong status. Toasts confirm the outcome from the action's response.
- **Guest privacy is enforced by the server, not the UI.** A guest's socket only ever receives their own `registrations` rows. The `userId` filter in `useBoard().mine` is only there so an organizer's personal view isn't cluttered with everyone else's rows.
- **"Processing…" badge.** It covers the brief moment between the registration row arriving and its spot arriving. These are two separate broadcasts.
- Added `--color-ticket*` tokens for the meter. Full theming comes in step 5.

**Tested:** `tsc` and `eslint` are clean, and the unit suite passes 12/12. The UI is checked in the real browser in step 6 (smoke and multi-user e2e).

## Step 4 — Organizer UI

**What:**
- `/organizer` is the check-in dashboard:
  - Live totals for confirmed, waitlisted and checked in (checked-in shown as x / confirmed), with a capacity bar for each session.
  - A table of all registrations with guest name and email, session and status (Confirmed / Waitlist #n / Checked in).
  - Filters by event, session and status, plus search by name or email.
  - **Check in / Undo** buttons, and **Remove**, which goes through the `cancel` action and promotes the next person on the waitlist.
- `/manage` handles creating and editing events (direct `useMutations`, confirmed variants) and creating, editing and deleting sessions (server actions). The capacity field shows a hint and refuses values below the confirmed count.
- `/people` lets an organizer switch any user between guest and organizer with `useUsers().setRole`.
- `OrganizerOnly` is a UI gate on these pages. Nav entries are shown only for the `admin` role.

**Decisions / tradeoffs:**
- **The UI gate is only for convenience.** The real boundary is on the server. A guest's socket never receives other people's registrations or emails, since emails only go to admins. Every organizer action also re-checks `role === 'admin'` on the server.
- **Organizer = `admin`, guest = `member`.** These are DeepSpace's built-in roles, so no custom role system is needed. `users.role` is a protected column, and `setRole` is refused unless the caller is already an admin. The app owner is always pinned to admin, so the app can never end up with no organizers. On the People page you can't change your own role, which avoids accidentally locking yourself out.
- **Check-in is disabled for waitlisted guests** in the UI, and the `setCheckIn` action refuses it too.
- **Deletes that would orphan data are refused** rather than cascaded, with a clear message ("Delete the event’s sessions first").

**Tested:** `tsc` and `eslint` are clean. These pages are exercised in the browser by the step 6 e2e specs.

## Step 5 — Design

**What:**
- **"Doorlist" theme** (`src/themes.css`, `src/themes.ts`, first-paint colour in `index.html`): warm paper background, ink text, a deep teal primary, and green → amber → brick for the capacity meter.
- **Static landing page** (`/`) replaces the scaffold placeholder. It has a headline, a ticket-stub illustration of the live capacity bar (filled with a CSS-only animation that respects reduced motion), and a three-step explainer. It stays static and prerendered, with no auth fetch and no WebSocket.
- Brand name `Doorlist` (`src/brand.ts`) is used in the nav and page titles. `APP_NAME` is still the deploy name and subdomain (`event-board`). SEO title and description are filled in.

**Decisions / tradeoffs:**
- **Light, warm theme** rather than the scaffold's dark slate. A check-in board gets used on phones in bright venues, so contrast in daylight matters more than a dark aesthetic.
- **System fonts** with no web-font dependency, to keep first paint fast and avoid a font flash on the static landing page.

**Tested:** `tsc`, `eslint` and unit tests (12/12) pass. `vite build` succeeds and the prerender wrote `/`. The only warning is the >500 kB chunk, which is the scaffold's SDK bundle and not this app's code.

## Step 6 — Tests

**What:**
- `tests/smoke.spec.ts`: the board renders for signed-out visitors, and `/my-registrations`, `/organizer`, `/manage` and `/people` show the sign-in gate with none of their protected content in the DOM.
- `tests/api.spec.ts`:
  - Every action returns 401 without sign-in.
  - A guest gets "Only organizers…" from each organizer action.
  - With an organizer:
    - Two guests race for a 1-seat session and get exactly one confirmed and one waitlisted.
    - A duplicate registration is refused.
    - A guest can't cancel someone else's registration.
    - A waitlisted guest can't be checked in, but a confirmed one can.
    - Capacity can't drop below the confirmed count, and raising it promotes the waitlist.
    - A session with registrations can't be deleted.
    - Owners can cancel their own registration.
- `tests/collab.spec.ts`: a three-browser flow (organizer, Guest A, Guest B) on a 1-seat session:
  - Live bar 0/1 → A registers → B sees 1/1 and "Join waitlist" live → B joins → A sees "Full · 1 on waitlist" live.
  - B's own list shows only B's registration, and B gets "Organizers only" on the dashboard.
  - The organizer sees both rows, sees check-in disabled for the waitlisted guest, and checks A in; A sees "Checked in" live.
  - A cancels → B is promoted to "Registered" live, both on B's page and on the dashboard.
- `tests/helpers/board.ts`: `actionAs(page, …)` calls actions with the page's own session JWT, plus helpers for seeding and cleanup. Test data is prefixed `__test-…__` and removed in `finally`.
- Created 3 test accounts in the local pool: "Organizer", "Guest A", "Guest B" (`@deepspace.test`, random passwords stored only in `~/.deepspace/test-accounts.json`). `organizer-1@` was already taken globally, so the organizer address has a random suffix.

**Decisions / tradeoffs:**
- **No test backdoor for the organizer role.** The only way to become admin is for an existing admin to promote you. The local debug `set-role` endpoint also requires an admin. Specs that need an organizer check the role with a harmless probe and **skip with instructions** until the owner promotes "Organizer" once on `/people`. The promotion persists in the local Durable Object.
- The race test drives real concurrent requests, not mocks. It checks the uniqueness-constraint design from step 1.

**Tested:** `npx deepspace test run all` → **23 passed, 2 skipped**. All 12 unit tests passed. The 2 skipped are the organizer-dependent specs, which are waiting for the one-time promotion. No app registration, push or deploy took place.
