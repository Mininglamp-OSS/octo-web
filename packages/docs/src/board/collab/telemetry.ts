// Observable telemetry + awareness surface (frontend-design §5.7.4).
//
// Two read-only surfaces the binding keeps current so tests and dev tooling can *observe* what the
// loop is doing without instrumenting internals:
//
//   __telemetry  — monotonic counters for the binding's decision points: how many local diffs were
//                  written, how many remote applies ran, how many writes were skipped by each of
//                  the three anti-self-loop guards, how many CAS arbitrations rejected a stale
//                  incoming element. A self-excitation loop would show up here as unbounded growth
//                  of localWrites/remoteApplies in lockstep — so these counters are the primary
//                  assertion target for the M-1 anti-loop tests.
//
//   __awareness  — the non-persisted presence channel (selection / cursor live here, NOT in the
//                  Y.Doc; XIN-16 §7). v1 exposes a minimal local-state setter + a snapshot.

/** Monotonic counters. All start at 0 and only increase. */
export interface BindingTelemetry {
  /** Local Excalidraw onChange events received. */
  localChanges: number
  /** Elements written to the Y.Doc from a local edit (after CAS + diff). */
  localWrites: number
  /** Remote Y.Doc updates applied to the canvas via updateScene. */
  remoteApplies: number
  /** Elements pushed into a remote updateScene. */
  remoteElements: number
  /** Writes skipped because the local diff was empty (guard 2). */
  skippedEmptyDiff: number
  /** onChange callbacks short-circuited because a remote apply was in flight (guard 3). */
  skippedApplyingRemote: number
  /** observe events for our OWN LOCAL_ORIGIN write, not re-applied to the canvas (guard 1). */
  skippedOwnOrigin: number
  /** Incoming elements rejected by CAS as stale (lower/equal version). */
  casRejected: number
  /** Remote applies skipped because the doc held no elements (size>0 guard; never push []). */
  skippedEmptyApply: number
}

export function emptyTelemetry(): BindingTelemetry {
  return {
    localChanges: 0,
    localWrites: 0,
    remoteApplies: 0,
    remoteElements: 0,
    skippedEmptyDiff: 0,
    skippedApplyingRemote: 0,
    skippedOwnOrigin: 0,
    casRejected: 0,
    skippedEmptyApply: 0,
  }
}

/** A single peer's presence state. Selection/cursor are presence, never Y.Doc content. */
export interface AwarenessState {
  selectedElementIds?: string[]
  cursor?: { x: number; y: number } | null
  [k: string]: unknown
}

/**
 * Minimal awareness surface. v1 only tracks the local peer's state and exposes a snapshot; the
 * cross-peer fan-out binds to the provider's `awareness` protocol when the backend lands. Kept
 * here so the observable surface (`binding.__awareness`) exists and is testable now.
 */
export class AwarenessSurface {
  private local: AwarenessState = {}

  setLocalState(state: AwarenessState | null): void {
    this.local = state ?? {}
  }

  getLocalState(): AwarenessState {
    return { ...this.local }
  }
}
