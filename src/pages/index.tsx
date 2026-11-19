/**
 * Landing page — STATIC (no providers, prerendered). See the scaffold notes in
 * git history for the static-page contract; keep it renderable without a
 * browser and keep `data-testid="static-landing"`.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { BRAND } from '../brand'
import { seo } from '../seo'

const steps = [
  {
    n: '01',
    title: 'Pick a session',
    body: 'Every session shows how many seats are left. The bars move as people sign up.',
  },
  {
    n: '02',
    title: 'Save your seat, or your place in line',
    body: 'If a session is full, join the waitlist. When someone cancels, the next person moves up automatically.',
  },
  {
    n: '03',
    title: 'Get checked in at the door',
    body: 'Organizers see every registration on one live dashboard and check guests in with one tap.',
  },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">{BRAND}</span>
          <Link to="/home" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Browse events
          </Link>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 sm:pt-20">
          <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                The guest list that keeps itself up to date.
              </h1>
              <p className="mt-6 max-w-md text-lg text-muted-foreground">
                Register for sessions, watch seats fill in real time, and skip the clipboard at the door.
              </p>
              <Link
                to="/home"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                See upcoming events
              </Link>
            </div>

            {/* A static ticket stub illustrating the live capacity bar. */}
            <div aria-hidden className="relative rotate-[-2deg] rounded-2xl border border-border bg-card p-6 shadow-[0_12px_40px_-12px_rgba(60,45,20,0.25)]">
              <div className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
              <div className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workshop · 2:00 PM</p>
              <p className="mt-2 text-xl font-semibold">Designing for the door</p>
              <div className="mt-6 h-2 rounded-full bg-muted">
                <div className="landing-fill h-full rounded-full bg-ticket-low" />
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">27</span> / 30 seats
                </span>
                <span>3 left</span>
              </div>
              <div className="mt-6 border-t border-dashed border-border pt-4 text-sm">
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">Registered</span>
              </div>
            </div>
          </div>

          <ol className="mt-24 grid gap-8 border-t border-border pt-10 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n}>
                <p className="font-mono text-xs text-muted-foreground">{s.n}</p>
                <h2 className="mt-2 font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </main>
      </div>
    </>
  )
}
