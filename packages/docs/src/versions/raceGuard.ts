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
//   - begin() bumps the PRIMARY generation and aborts EVERYTHING in the guard (primary + any
//     follow-up), then hands back a primary ticket bound to the new generation.
//   - beginFollowUp() bumps a SEPARATE follow-up token and aborts only a prior follow-up. Its
//     ticket is current only while BOTH the primary generation is unchanged AND it is still the
//     latest follow-up, so:
//       * a later begin() (filter switch / restore / delete) supersedes it — the page is dropped
//         rather than appended onto a list that no longer exists; and
//       * a later beginFollowUp() (a second rapid load-more) also supersedes it — the earlier
//         page, even if its request resolved a hair before being aborted, is dropped rather than
//         appended as stale / duplicate rows. (A shared generation alone could not express this:
//         two follow-ups share the primary generation, so the aborted first ticket would wrongly
//         still report itself current — the bug this lane token fixes.)
//   The primary lane is NOT affected by follow-ups: a load-more never invalidates an in-flight
//   refresh/preview ticket.
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
  // Primary generation (refresh / preview). Follow-ups also observe it so a new primary drops them.
  let generation = 0
  // Separate follow-up token: distinguishes rapid successive load-mores that share `generation`.
  let followToken = 0
  let primary: AbortController | null = null
  let followUp: AbortController | null = null

  const primaryTicket = (gen: number, controller: AbortController): GuardTicket => ({
    signal: controller.signal,
    isCurrent: () => gen === generation,
  })

  const followTicket = (gen: number, token: number, controller: AbortController): GuardTicket => ({
    signal: controller.signal,
    // Current only if neither a newer primary NOR a newer follow-up has superseded this one.
    isCurrent: () => gen === generation && token === followToken,
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
      // Invalidate any outstanding follow-up ticket bound to the previous list.
      followToken++
      return primaryTicket(gen, controller)
    },
    beginFollowUp() {
      // Cancel a prior page and advance the follow-up token so its ticket goes stale — being
      // aborted alone does not flip isCurrent(), so a page that resolved just before the abort
      // must be excluded by the token, not merely by the signal. Keeps the primary generation so a
      // later begin() can still invalidate this page.
      followUp?.abort()
      const controller = new AbortController()
      followUp = controller
      const token = ++followToken
      return followTicket(generation, token, controller)
    },
    abort() {
      primary?.abort()
      followUp?.abort()
      primary = null
      followUp = null
      // Bump both so any outstanding ticket's isCurrent() flips to false even without a fresh begin().
      generation++
      followToken++
    },
  }
}
