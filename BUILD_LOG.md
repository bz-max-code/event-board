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
