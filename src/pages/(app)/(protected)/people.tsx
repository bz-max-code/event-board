/**
 * Organizer: manage who is an organizer.
 *
 * Roles are DeepSpace app roles: organizer = `admin`, guest = `member`.
 * `useUsers().setRole` is enforced by the Durable Object — it is refused
 * unless the caller is already an admin — and the app owner is always pinned
 * to admin, so the owner can't be demoted (or lock everyone out).
 */

import { useState } from 'react'
import { useAuth, useUsers } from 'deepspace'
import { Badge, Button, ConfirmModal, SearchInput } from '@/components/ui'
import { OrganizerOnly } from '@/components/OrganizerOnly'

export default function PeoplePage() {
  return (
    <OrganizerOnly>
      <People />
    </OrganizerOnly>
  )
}

function People() {
  const { users, usersLoaded, setRole } = useUsers()
  const { userId } = useAuth()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<{ id: string; name: string; role: 'admin' | 'member' } | null>(null)

  const q = query.trim().toLowerCase()
  const rows = users
    .filter((u) => !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
    .sort((a, b) => (a.role === b.role ? (a.name ?? '').localeCompare(b.name ?? '') : a.role === 'admin' ? -1 : 1))

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Organizer</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">People</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Everyone who signs in starts as a guest. Make someone an organizer to let them manage events and check
        guests in. The app owner is always an organizer.
      </p>

      <SearchInput
        className="mt-6 max-w-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
      />

      <ul className="mt-4 divide-y divide-border rounded-xl border border-border" data-testid="people">
        {!usersLoaded && <li className="h-16 animate-pulse bg-card" aria-busy="true" />}
        {rows.map((u) => {
          const isOrganizer = u.role === 'admin'
          return (
            <li key={u.id} className="flex items-center gap-3 p-4" data-testid="person" data-email={u.email}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {u.name || u.email}
                  {u.id === userId && <span className="text-muted-foreground"> (you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Badge variant={isOrganizer ? 'default' : 'secondary'}>{isOrganizer ? 'Organizer' : 'Guest'}</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={u.id === userId}
                title={u.id === userId ? 'You can’t change your own role' : undefined}
                onClick={() => setPending({ id: u.id, name: u.name || u.email || 'this user', role: isOrganizer ? 'member' : 'admin' })}
              >
                {isOrganizer ? 'Make guest' : 'Make organizer'}
              </Button>
            </li>
          )
        })}
      </ul>

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending) setRole(pending.id, pending.role)
          setPending(null)
        }}
        variant="default"
        title={pending?.role === 'admin' ? `Make ${pending?.name} an organizer?` : `Make ${pending?.name} a guest?`}
        description={
          pending?.role === 'admin'
            ? 'They’ll see every registration, manage events, and check guests in.'
            : 'They’ll lose access to the dashboard and event management.'
        }
        confirmText={pending?.role === 'admin' ? 'Make organizer' : 'Make guest'}
      />
    </div>
  )
}
