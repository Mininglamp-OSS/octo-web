// Unified async race guard for the version-history panels (XIN-836 技术统一项②).
//
// This consolidates the board panel's "AbortController + monotonic generation" pattern into a
// single reusable primitive so every end's version panel guards its list-refresh / load-more /
// preview chains identically. It supersedes the doc panel's `previewGuard` (last-write-wins
// TOKEN only, never aborts the in-flight request) — that guard is a strict subset of this one.
//
// Two guarantees matter, and both are enforced here:
//   1. In-flight requests are TRULY aborted (AbortController), not merely ignored on arrival, so
//      switching filters fast, or previewing #A then #B, cancels the wasted request on the wire.
//   2. A response that resolves AFTER a newer request started is discarded (monotonic
//      generation), so a slow earlier call can never overwrite a newer selection — the stale
//      "#A body under a Preview #B header" bug that sits right next to the restore red line.
//
// A guard has a PRIMARY lane (refresh / filter switch / preview) and a subordinate FOLLOW-UP
// lane (load-more):
//   - begin() bumps the generation and aborts EVERYTHING in the guard (primary + any follow-up),
//     then hands back a ticket bound to the new generation.
//   - beginFollowUp() starts a request bound to the CURRENT generation with its own abort
//     controller (aborting only a prior follow-up). It does NOT bump the generation, so a later
//     begin() supersedes it: a page that resolves after a filter switch / restore / delete
//     replaced the list is dropped rather than appended onto a list that no longer exists.
//
// A panel typically holds one guard for the list (refresh = primary, load-more = follow-up) and a
// second, independent guard for preview (primary only — it never calls beginFollowUp).

/** A single guarded request's handle. */
export interface GuardTicket {
  /**
   * Pass this to the underlying fetch (`{ signal }`) so a superseding request aborts this one on
   * the wire. Reading it is always safe even after the request is superseded.
   */
  readonly signal: AbortSignal
  /**
   * True only while this ticket is still the guard's latest generation. Call it after EVERY await
   * — both when the request resolves AND in the catch — and bail out when it returns false, so a
   * stale response (or a stale error) never touches state.
   */
  isCurrent(): boolean
}

export interface RaceGuard {
  /** Start a new primary request (refresh / filter switch / preview). Aborts all in-flight work in
   *  this guard and bumps the generation. */
  begin(): GuardTicket
  /** Start a follow-up request (load-more) bound to the current generation. Aborts only a prior
   *  follow-up; does not bump the generation, so a later begin() supersedes it. */
  beginFollowUp(): GuardTicket
  /** Abort every in-flight request and invalidate all outstanding tickets (unmount cleanup). */
  abort(): void
}

/** Create a fresh race guard (one per lane, held in a useRef for the component's lifetime). */
export function createRaceGuard(): RaceGuard {
  let generation = 0
  let primary: AbortController | null = null
  let followUp: AbortController | null = null

  const ticketFor = (gen: number, controller: AbortController): GuardTicket => ({
    signal: controller.signal,
    isCurrent: () => gen === generation,
  })

  return {
    begin() {
      // A new primary supersedes both the prior primary and any subordinate page in flight.
      primary?.abort()
      followUp?.abort()
      followUp = null
      const controller = new AbortController()
      primary = controller
      const gen = ++generation
      return ticketFor(gen, controller)
    },
    beginFollowUp() {
      // Cancel a prior page but keep the current generation: this page belongs to the list the
      // most recent begin() produced, and a later begin() must be able to invalidate it.
      followUp?.abort()
      const controller = new AbortController()
      followUp = controller
      return ticketFor(generation, controller)
    },
    abort() {
      primary?.abort()
      followUp?.abort()
      primary = null
      followUp = null
      // Bump so any outstanding ticket's isCurrent() flips to false even without a fresh begin().
      generation++
    },
  }
}
