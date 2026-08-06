// Origin-checked bootstrap transfer for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// The PPT editor / preview / present surfaces mount a SAME-ORIGIN Bento container (an iframe served
// from the page's own origin). Before Bento can render it needs its bootstrap payload — the source
// mode, the version to load, and the short-lived signed asset metadata the backend R3-B1 layer
// produces. That payload is handed to the frame over `postMessage`, which is a CROSS-DOCUMENT channel
// even when both documents share an origin, so every hop MUST be origin-checked:
//
//   1. Host → frame delivery pins an explicit `targetOrigin` and REFUSES to post with the `'*'`
//      wildcard. A wildcard would let the payload (which may carry signed, if short-lived, asset
//      access) leak to whatever document happens to occupy the frame if its src is ever navigated
//      cross-origin. We only ever deliver to `window.location.origin`.
//   2. Frame → host requests are accepted ONLY when `event.origin === window.location.origin`. A
//      message from any other origin is dropped without a reply (the negative control): a
//      cross-origin document embedding or being embedded by this page can neither trigger a
//      bootstrap delivery nor observe one.
//
// This module is pure and framework-free so the origin gate can be unit-tested directly, including
// the cross-origin rejection path the acceptance matrix calls out (reject cross-origin handoff —
// negative-control test). It performs NO network I/O and issues NO Hocuspocus token; the bootstrap
// object is supplied by the caller (gated behind PPT_SOURCE_ENABLED until R3-B1 merges).

/**
 * Protocol tag carried on every bootstrap message. Bumped only on a breaking envelope change so a
 * stale frame/host pair fails closed (unrecognized protocol → ignored) instead of misreading a
 * differently-shaped payload.
 */
export const PPT_BOOTSTRAP_PROTOCOL = 'octo-ppt-bootstrap/1' as const

/** The three consumption modes whose bootstrap payloads the backend R3-B1 layer distinguishes. */
export type PptBootstrapMode = 'preview' | 'editor' | 'present'

/**
 * The bootstrap payload delivered to the same-origin Bento frame. Shape mirrors the R3-B1 source
 * contract; it is treated as opaque transport here (this module only guards the ORIGIN of the hop,
 * never interprets the source). `version` is `'latest'` or a positive integer version sequence;
 * `assets` is the signed, short-lived asset bootstrap metadata (no long-lived auth material).
 */
export interface PptBootstrap {
  mode: PptBootstrapMode
  docId: string
  /** `'latest'` or a published `version_seq` (>= 1). */
  version: 'latest' | number
  /** Backend rendered-source URL (bare-relative on the shared apiClient) the frame should load. */
  sourceUrl: string
  /** Signed short-lived asset bootstrap metadata from R3-B1; opaque to the transfer layer. */
  assets?: Record<string, unknown>
  /** Whether the caller resolved a writer/admin (editor) vs reader/commenter (read-only) context. */
  canEdit?: boolean
}

/** Frame → host: "I'm ready, send me the bootstrap for this doc/mode." */
export interface BootstrapRequestMessage {
  protocol: typeof PPT_BOOTSTRAP_PROTOCOL
  type: 'request'
  docId: string
  mode: PptBootstrapMode
}

/** Host → frame: the bootstrap payload (or an explicit refusal the frame can surface). */
export interface BootstrapDeliverMessage {
  protocol: typeof PPT_BOOTSTRAP_PROTOCOL
  type: 'deliver'
  bootstrap: PptBootstrap
}

/**
 * The current document's origin, or `''` under SSR / a non-browser test host. Centralized so every
 * gate reads the SAME value and a missing `window` fails closed (empty origin never equals a real
 * `event.origin`, so nothing is trusted).
 */
export function currentOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location?.origin ?? ''
}

/**
 * Whether `origin` is this document's own origin — the single trust predicate for both hops.
 *
 * Rejects the empty string explicitly: a `MessageEvent` from a `srcdoc` / sandboxed frame without
 * `allow-same-origin` reports `origin === ''` (an opaque origin), and `file:`/data documents report
 * `'null'`. Neither is our origin, so both fail here; only a byte-for-byte match with a non-empty
 * `window.location.origin` is trusted. There is no wildcard and no substring match.
 */
export function isTrustedOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== 'string' || origin.length === 0) return false
  const self = currentOrigin()
  if (self.length === 0) return false
  return origin === self
}

/** Type guard for a well-formed inbound bootstrap request (frame → host). */
export function isBootstrapRequest(data: unknown): data is BootstrapRequestMessage {
  if (data === null || typeof data !== 'object') return false
  const m = data as Record<string, unknown>
  return (
    m.protocol === PPT_BOOTSTRAP_PROTOCOL &&
    m.type === 'request' &&
    typeof m.docId === 'string' &&
    m.docId.length > 0 &&
    (m.mode === 'preview' || m.mode === 'editor' || m.mode === 'present')
  )
}

/** Type guard for a well-formed inbound bootstrap delivery (host → frame). */
export function isBootstrapDeliver(data: unknown): data is BootstrapDeliverMessage {
  if (data === null || typeof data !== 'object') return false
  const m = data as Record<string, unknown>
  return (
    m.protocol === PPT_BOOTSTRAP_PROTOCOL &&
    m.type === 'deliver' &&
    typeof m.bootstrap === 'object' &&
    m.bootstrap !== null
  )
}

/**
 * Deliver a bootstrap payload to the same-origin Bento frame.
 *
 * `targetOrigin` MUST be this document's own origin — the call throws otherwise, and it NEVER falls
 * back to the `'*'` wildcard. Passing `'*'` (or any cross-origin value) is a programming error that
 * would defeat the whole gate, so it is rejected loudly rather than silently downgraded. This is the
 * only function that calls `postMessage` toward the frame.
 */
export function deliverBootstrap(
  target: Pick<Window, 'postMessage'>,
  targetOrigin: string,
  bootstrap: PptBootstrap,
): void {
  if (!isTrustedOrigin(targetOrigin)) {
    throw new Error(
      `refusing to deliver PPT bootstrap to a non-same-origin target (${String(targetOrigin)}); ` +
        'the Bento container is same-origin and the payload is never posted with a wildcard origin',
    )
  }
  const message: BootstrapDeliverMessage = {
    protocol: PPT_BOOTSTRAP_PROTOCOL,
    type: 'deliver',
    bootstrap,
  }
  target.postMessage(message, targetOrigin)
}

export interface ServeBootstrapOptions {
  /**
   * Produce the bootstrap for a validated same-origin request, or `null` to decline (e.g. the docId
   * does not match this host, or source is gated off). Declining sends no reply.
   */
  provide: (request: BootstrapRequestMessage) => PptBootstrap | null
  /**
   * Observe a REJECTED cross-origin / malformed message (test + telemetry hook). Never receives a
   * trusted request. Optional.
   */
  onReject?: (event: MessageEvent) => void
  /** Injectable event target for tests; defaults to `window`. */
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * Host-side listener that answers same-origin bootstrap requests from the Bento frame and rejects
 * everything else. Returns a disposer that detaches the listener.
 *
 * The origin gate is the FIRST thing checked on every inbound message: a request whose
 * `event.origin` is not `window.location.origin` is dropped (routed to `onReject`) before its
 * payload is even shape-checked, and no reply is posted — so a cross-origin frame can neither pull a
 * bootstrap nor learn whether one exists (the negative-control requirement). A trusted, well-formed
 * request is answered by posting the bootstrap back through `event.source`, pinned to the SAME
 * validated `event.origin` (which equals our own origin here) — never `'*'`.
 */
export function serveBootstrap(options: ServeBootstrapOptions): () => void {
  const target: Pick<Window, 'addEventListener' | 'removeEventListener'> =
    options.eventTarget ?? (typeof window !== 'undefined' ? window : undefined as never)
  if (!target) return () => {}

  const handler = (event: MessageEvent): void => {
    // Gate 1 — ORIGIN. Reject anything not from our own origin before touching the payload.
    if (!isTrustedOrigin(event.origin)) {
      options.onReject?.(event)
      return
    }
    // Gate 2 — SHAPE. A same-origin message that is not a well-formed request is ignored (it may be
    // unrelated same-origin postMessage traffic); route it to onReject for visibility but never reply.
    if (!isBootstrapRequest(event.data)) {
      options.onReject?.(event)
      return
    }
    const bootstrap = options.provide(event.data)
    if (bootstrap === null) return
    const source = event.source
    if (!source || typeof (source as Window).postMessage !== 'function') return
    // Reply pinned to the validated origin (== our origin). Deliver re-asserts the trust gate as
    // defense in depth, so a future refactor of `event.origin` handling cannot open a wildcard hole.
    deliverBootstrap(source as Window, event.origin, bootstrap)
  }

  target.addEventListener('message', handler as EventListener)
  return () => target.removeEventListener('message', handler as EventListener)
}
