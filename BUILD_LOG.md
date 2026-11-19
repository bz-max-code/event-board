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
