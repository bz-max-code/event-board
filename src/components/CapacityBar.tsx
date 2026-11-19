import type { Occupancy } from '@/lib/queue'
import { cn } from '@/lib/utils'

/** Live seat meter: filled seats out of capacity, plus waitlist length. */
export function CapacityBar({ occ, className }: { occ: Occupancy; className?: string }) {
  const pct = occ.capacity > 0 ? Math.min(100, Math.round((occ.confirmed / occ.capacity) * 100)) : 0
  const left = Math.max(0, occ.capacity - occ.confirmed)
  return (
    <div className={cn('space-y-1.5', className)} data-testid="capacity">
      <div
        role="meter"
        aria-label="Seats taken"
        aria-valuemin={0}
        aria-valuemax={occ.capacity}
        aria-valuenow={occ.confirmed}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            occ.full ? 'bg-ticket-full' : pct >= 75 ? 'bg-ticket-low' : 'bg-ticket',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-xs tabular-nums text-muted-foreground">
        <span data-testid="capacity-count">
          <span className="font-medium text-foreground">{occ.confirmed}</span> / {occ.capacity} seats
        </span>
        <span data-testid="capacity-status">
          {occ.full
            ? occ.waitlisted > 0
              ? `Full · ${occ.waitlisted} on waitlist`
              : 'Full'
            : `${left} left`}
        </span>
      </div>
    </div>
  )
}
