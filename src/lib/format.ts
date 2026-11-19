const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function parse(value?: string | null): Date | null {
  if (!value) return null
  // A bare YYYY-MM-DD is a calendar date; parse it as local, not UTC midnight.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(value?: string | null): string {
  const d = parse(value)
  return d ? dateFmt.format(d) : ''
}

export function formatTimeRange(start?: string | null, end?: string | null): string {
  const s = parse(start)
  const e = parse(end)
  if (!s) return ''
  return e ? `${timeFmt.format(s)} – ${timeFmt.format(e)}` : timeFmt.format(s)
}

/** `datetime-local` input value ⇄ ISO string. */
export function toLocalInput(iso?: string | null): string {
  const d = parse(iso)
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}
