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

/** The CSP meta element injected at the head of the deck document. */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PPT_FRAME_CSP}">`

/**
 * Inject the PPT-frame CSP `<meta>` into a deck's rendered HTML so it governs the srcdoc document
 * BEFORE any deck script runs. Inserts just inside `<head>` when present; otherwise opens a `<head>`
 * right after `<html>`; otherwise prepends the meta (a srcdoc fragment gets an implicit head and the
 * meta still applies before body content is parsed). A deck that already ships its own CSP meta keeps
 * it — the browser enforces the INTERSECTION, so our `connect-src 'none'` still binds. The tag is
 * matched with a function replacer so no `$`-sequence in the deck HTML is treated as a replacement
 * pattern.
 */
export function withFrameCsp(html: string): string {
  if (typeof html !== 'string') return html
  const headOpen = /<head\b[^>]*>/i
  if (headOpen.test(html)) {
    return html.replace(headOpen, (m) => `${m}${CSP_META}`)
  }
  const htmlOpen = /<html\b[^>]*>/i
  if (htmlOpen.test(html)) {
    return html.replace(htmlOpen, (m) => `${m}<head>${CSP_META}</head>`)
  }
  return `${CSP_META}${html}`
}
