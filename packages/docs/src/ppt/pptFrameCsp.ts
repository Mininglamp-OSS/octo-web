// PPT-frame Content-Security-Policy for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1621).
//
// P1-2 (round-5, defence-in-depth). The Bento deck runs in an OPAQUE-origin `srcdoc` frame with
// `allow-scripts` but NOT `allow-same-origin` (BentoContainer.tsx / XIN-1608 P0), so the deck's
// scripts can already touch nothing in the parent origin. What the opaque sandbox does NOT stop is the
// frame's own scripts opening OUTBOUND connections — `fetch`/XHR/WebSocket/EventSource/`sendBeacon` to
// an attacker endpoint — i.e. exfiltrating whatever the deck can read (its own bytes, referrer, etc.).
//
// R3's contract is that a rendered deck is SELF-CONTAINED at the byte boundary (pptSourceClient.ts):
// fonts/media inline as `data:`/`blob:`, charts/morph run on Bento's bundled engine, and nothing
// legitimate needs the network at render time. So we can inject a restrictive CSP `<meta>` into the
// srcdoc that DENIES `connect-src` (and form submission / base-tag tricks) while still allowing the
// inline/eval/`data:`/`blob:` runtime Bento needs. This is FULLY FE-wireable — it lives in the srcdoc
// bytes we already control — and needs no change to the global nginx / index.html CSP.
//
// P1-1 (round-6, XIN-1630 — the containment must not be bypassable by the deck author it contains).
// The deck HTML is attacker-controlled and NOT sanitized. A meta CSP only governs the document if the
// browser parses it as the FIRST directive of the real `<head>` before any deck script runs, so the
// injection MUST land there under the HTML5 tree-construction rules — not merely at the first textual
// `<head>` match. Regex surgery over untrusted HTML cannot guarantee that: a `<head>` inside a leading
// comment, a `<script>` hoisted into an implicit head ahead of a later literal `<head>`, or a `<head`
// inside a quoted attribute all displace a textual-match injection so the deck ends up ungoverned
// (fail OPEN). We therefore PARSE the HTML with the browser's own HTML parser, insert the meta as the
// first child of the real `<head>` via the DOM, and re-serialize — so those vectors fail CLOSED. See
// `withFrameCsp` and the adversarial cases in pptFrameCsp.test.ts.
//
// NOT covered here (filed as a follow-up, see the PR body / issue): the PARENT-document `frame-src`
// that would allowlist exactly this frame in the app's TOP-LEVEL CSP. A meta CSP cannot set another
// document's policy, and the app shell's CSP is delivered by the global nginx config the architect
// scoped OUT of R3 (no global nginx `connect-src`/`frame-src` tightening). That half is deferred with
// rationale rather than silently dropped.

/**
 * The CSP enforced inside the opaque Bento `srcdoc` frame. Permits the self-contained Bento runtime
 * (inline + eval scripts, inline styles, `data:`/`blob:` media/fonts/images) but sets
 * `connect-src 'none'` so the frame cannot open any outbound request — the fetch-exfiltration
 * containment. `base-uri 'none'` and `form-action 'none'` close the base-tag and form-POST exfil
 * side-channels a self-contained deck never needs. `http-equiv` meta supports these directives (it
 * does not support `frame-ancestors`/`sandbox`, which is why the sandbox attribute stays on the
 * iframe element).
 */
export const PPT_FRAME_CSP = [
  "default-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  'frame-src blob: data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** Serialize a parsed DocumentType back to source so re-serialization does not drop the deck's doctype
 *  (a missing `<!DOCTYPE html>` would force quirks mode and change how Bento lays the deck out). */
function serializeDoctype(dt: DocumentType): string {
  let s = `<!DOCTYPE ${dt.name}`
  if (dt.publicId) s += ` PUBLIC "${dt.publicId}"`
  if (dt.systemId) s += dt.publicId ? ` "${dt.systemId}"` : ` SYSTEM "${dt.systemId}"`
  return `${s}>`
}

/**
 * Inject the PPT-frame CSP `<meta>` so it governs the srcdoc document BEFORE any deck script runs.
 *
 * The deck HTML is attacker-controlled and unsanitized, so the injection must survive an adversarial
 * author (P1-1, XIN-1630). Rather than a textual `<head>` match — which a comment / pre-head script /
 * attribute-embedded `<head>` can displace so the meta lands somewhere inert (fail OPEN) — we parse
 * the HTML with the platform HTML parser (`DOMParser`, `text/html`, which follows the HTML5
 * tree-construction algorithm and never executes scripts), insert the meta as the FIRST child of the
 * parser's real `<head>`, and re-serialize. Because the browser re-parses our output the same way, the
 * meta is guaranteed to be the head's first directive — ahead of any deck `<script>`, including one
 * the parser hoists into an implicit head — so the (a) leading-comment, (b) pre-head-script, and
 * (c) `<head`-in-attribute vectors all fail CLOSED. A deck that ships its own CSP meta keeps it; ours
 * precedes it and the browser enforces the INTERSECTION, so `connect-src 'none'` still binds.
 *
 * `DOMParser` is a browser platform API and this surface only ever renders in an iframe, so it is
 * always present in production. Should it somehow be unavailable, we return the HTML unchanged rather
 * than fall back to a bypassable textual injection: the opaque-origin sandbox (P0) remains the primary
 * containment, and a control that cannot be placed reliably must not masquerade as one.
 */
export function withFrameCsp(html: string): string {
  if (typeof html !== 'string') return html
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const head = doc.head || doc.documentElement
  const meta = doc.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', PPT_FRAME_CSP)
  head.insertBefore(meta, head.firstChild)
  const doctype = doc.doctype ? serializeDoctype(doc.doctype) : ''
  return `${doctype}${doc.documentElement.outerHTML}`
}
