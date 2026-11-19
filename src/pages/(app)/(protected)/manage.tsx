/**
 * Organizer: create and edit events and their sessions.
 *
 * Events are written directly with useMutations (admin RBAC allows
 * create/update). Sessions and all deletions go through server actions so
 * capacity changes re-settle the waitlist and deletes can't orphan
 * registrations.
 */

import { useState, type FormEvent } from 'react'
import { useMutations } from 'deepspace'
import { CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, EmptyState, Input, Label, Modal, Textarea, useToast } from '@/components/ui'
import { OrganizerOnly } from '@/components/OrganizerOnly'
import { CapacityBar } from '@/components/CapacityBar'
import { useBoard, type SessionView } from '@/hooks/useBoard'
import { callAction } from '@/lib/actions'
import type { EventRow } from '@/lib/event-types'
import { formatDate, formatTimeRange, fromLocalInput, toLocalInput } from '@/lib/format'
import { minimumCapacity } from '@/lib/queue'

export default function ManagePage() {
  return (
    <OrganizerOnly>
      <Manage />
    </OrganizerOnly>
  )
}

type EventDraft = { id?: string } & EventRow
type SessionDraft = {
  id?: string
  eventId: string
  title: string
  startsAt: string
  endsAt: string
  capacity: string
  minCapacity?: number
}

function Manage() {
  const board = useBoard()
  const toast = useToast()
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'event' | 'session'; id: string; title: string } | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res =
      pendingDelete.kind === 'event'
        ? await callAction('deleteEvent', { eventId: pendingDelete.id })
        : await callAction('deleteSession', { sessionId: pendingDelete.id })
    setDeleting(false)
    setPendingDelete(null)
    if (!res.success) toast.error('Could not delete', res.error)
  }

  const editSession = (s: SessionView) =>
    setSessionDraft({
      id: s.id,
      eventId: s.data.eventId,
      title: s.data.title,
      startsAt: toLocalInput(s.data.startsAt),
      endsAt: toLocalInput(s.data.endsAt),
      capacity: String(s.data.capacity),
      minCapacity: minimumCapacity(s.spots, s.data.capacity),
    })

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Organizer</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Events & sessions</h1>
        </div>
        <Button
          onClick={() => setEventDraft({ title: '', description: '', location: '', date: '' })}
          data-testid="new-event"
        >
          <CalendarPlus aria-hidden /> New event
        </Button>
      </header>

      {board.ready && board.events.length === 0 && (
        <EmptyState
          icon={<CalendarPlus />}
          title="Create your first event"
          description="Add an event, then add sessions with a capacity. Guests can register right away."
        />
      )}

      <div className="space-y-6">
        {board.events.map((ev) => {
          const sessions = board.sessionsByEvent.get(ev.recordId) ?? []
          return (
            <section
              key={ev.recordId}
              className="rounded-xl border border-border bg-card"
              data-testid="manage-event"
              data-event-title={ev.data.title}
              data-event-id={ev.recordId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div>
                  <h2 className="font-semibold text-foreground">{ev.data.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {[formatDate(ev.data.date), ev.data.location].filter(Boolean).join(' · ') || 'No date or location'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEventDraft({ id: ev.recordId, ...ev.data })}
                    aria-label={`Edit ${ev.data.title}`}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDelete({ kind: 'event', id: ev.recordId, title: ev.data.title })}
                    aria-label={`Delete ${ev.data.title}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{s.data.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeRange(s.data.startsAt, s.data.endsAt) || 'No time set'}
                      </p>
                    </div>
                    <CapacityBar occ={s.occ} className="sm:w-56" />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => editSession(s)} aria-label={`Edit ${s.data.title}`}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingDelete({ kind: 'session', id: s.id, title: s.data.title })}
                        aria-label={`Delete ${s.data.title}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="p-3">
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="add-session"
                  onClick={() =>
                    setSessionDraft({ eventId: ev.recordId, title: '', startsAt: '', endsAt: '', capacity: '20' })
                  }
                >
                  <Plus aria-hidden /> Add session
                </Button>
              </div>
            </section>
          )
        })}
      </div>

      {eventDraft && <EventForm draft={eventDraft} onClose={() => setEventDraft(null)} />}
      {sessionDraft && <SessionForm draft={sessionDraft} onClose={() => setSessionDraft(null)} />}
      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={`Delete “${pendingDelete?.title}”?`}
        description={
          pendingDelete?.kind === 'event'
            ? 'Only events without sessions can be deleted.'
            : 'Only sessions without registrations can be deleted.'
        }
        confirmText="Delete"
      />
    </div>
  )
}

function EventForm({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const { ready, createConfirmed, putConfirmed } = useMutations<EventRow>('events')
  const toast = useToast()
  const [form, setForm] = useState(draft)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    const data: EventRow = {
      title: form.title.trim(),
      description: form.description?.trim() ?? '',
      location: form.location?.trim() ?? '',
      date: form.date || undefined,
    }
    try {
      if (form.id) await putConfirmed(form.id, data)
      else await createConfirmed(data)
      onClose()
    } catch (err) {
      toast.error('Could not save event', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <form onSubmit={submit} className="contents">
        <Modal.Header>
          <Modal.Title>{form.id ? 'Edit event' : 'New event'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="space-y-4">
          <Field label="Title" htmlFor="ev-title">
            <Input
              id="ev-title"
              required
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="ev-date">
              <Input id="ev-date" type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Location" htmlFor="ev-location">
              <Input
                id="ev-location"
                value={form.location ?? ''}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="ev-desc">
            <Textarea
              id="ev-desc"
              rows={3}
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            Save event
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

function SessionForm({ draft, onClose }: { draft: SessionDraft; onClose: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState(draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const params = {
      title: form.title.trim(),
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
      capacity: Number(form.capacity),
    }
    const res = form.id
      ? await callAction('updateSession', { sessionId: form.id, ...params })
      : await callAction('createSession', { eventId: form.eventId, ...params })
    setSaving(false)
    if (!res.success) return setError(res.error)
    toast.success(form.id ? 'Session updated' : 'Session added')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <form onSubmit={submit} className="contents">
        <Modal.Header>
          <Modal.Title>{form.id ? 'Edit session' : 'New session'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="space-y-4">
          <Field label="Title" htmlFor="s-title">
            <Input
              id="s-title"
              required
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="s-start">
              <Input
                id="s-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Ends" htmlFor="s-end">
              <Input
                id="s-end"
                type="datetime-local"
                value={form.endsAt}
                min={form.startsAt || undefined}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Capacity"
            htmlFor="s-cap"
            hint={
              form.minCapacity && form.minCapacity > 1
                ? `At least ${form.minCapacity}: that many guests are already confirmed. Raising it promotes people from the waitlist.`
                : undefined
            }
          >
            <Input
              id="s-cap"
              type="number"
              inputMode="numeric"
              required
              min={form.minCapacity ?? 1}
              max={10000}
              step={1}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save session
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
