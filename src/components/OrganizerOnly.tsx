import type { ReactNode } from 'react'
import { useUser } from 'deepspace'
import { ShieldAlert } from 'lucide-react'
import { EmptyState } from '@/components/ui'

/**
 * UI gate for organizer pages. This is convenience only — the real boundary
 * is server-side: guests never receive other people's registrations, and
 * every organizer action re-checks the caller's role.
 */
export function OrganizerOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser()
  if (isLoading || !user) {
    return <div className="mx-auto mt-10 h-32 max-w-5xl animate-pulse rounded-xl bg-card" aria-busy="true" />
  }
  if (user.role !== 'admin') {
    return (
      <EmptyState
        data-testid="organizers-only"
        icon={<ShieldAlert />}
        title="Organizers only"
        description="Ask an organizer to give your account organizer access on the People page."
      />
    )
  }
  return <>{children}</>
}
