// postMessage bridge between the sandboxed HTML-doc iframe and the parent viewer (issue #27).
//
// SECURITY MODEL (critical — read before editing):
//   Agent-authored HTML is NOT sanitized end-to-end, so it may run arbitrary <script>. The frame
//   uses sandbox="allow-scripts" WITHOUT allow-same-origin (the two together defeat the sandbox and
//   must NEVER be combined). With allow-scripts alone the doc runs in an opaque origin: it cannot
//   touch the parent DOM/credentials/origin, submit forms, open popups, download, or navigate the
//   top frame, and the parent cannot read the cross-origin contentDocument — selection/anchor data
//   crosses this narrow postMessage bridge instead.
//
//   THREAT BOUNDARY: the sandbox does NOT stop OUTBOUND network from doc JS (fetch/XHR/img/beacon
//   to author-chosen hosts). Network egress is an ACCEPTED capability for agent-authored HTML — do
//   NOT claim "no exfiltration." The iframe sets referrerPolicy="no-referrer" so our page URL never
//   leaks as a Referer, but content the doc already holds can still be sent out.
//
//   The doc script is UNTRUSTED and can forge any same-document message. The parent accepts ONLY
//   non-privileged UI FACTS (a selection-anchor descriptor, an anchor's display text) whose
//   worst-case forgery is a bogus comment target the human still reviews and submits. There is NO
//   privileged RPC. Every inbound message is gated by event.source === the iframe's contentWindow
//   AND a bounded schema check.
//
//   A per-render TOKEN is embedded in each srcDoc build and echoed on frame→parent replies. It is
//   NOT a secret (hostile doc JS can read it) and grants NO authority; it only isolates stale /
//   cross-generation traffic. Facts stay non-privileged — the token is a correlation id, not auth.

export const BRIDGE_CHANNEL = 'octodoc-bridge'

/** Frame→parent: selection changed. anchor=null clears a prior report. */
export interface BridgeSelectionMessage {
  channel: typeof BRIDGE_CHANNEL
  type: 'selection'
  token: string
  anchor: BridgeAnchor | null
}

/** Parent→frame: resolve an element anchor's display text. nonce correlates the reply. */
export interface BridgeResolveRequest {
  channel: typeof BRIDGE_CHANNEL
  type: 'resolve-anchor-text'
  token: string
  nonce: string
  aid: string
}

/** Frame→parent: resolved element text for a prior request. */
export interface BridgeResolveResponse {
  channel: typeof BRIDGE_CHANNEL
  type: 'anchor-text'
  token: string
  nonce: string
  text: string | null
}

/** Parent→frame: scroll an anchored element into view and briefly highlight it. */
export interface BridgeScrollRequest {
  channel: typeof BRIDGE_CHANNEL
  type: 'scroll-to-anchor'
  token: string
  aid: string
}

export type BridgeInbound = BridgeSelectionMessage | BridgeResolveResponse

// WIRE contract the parent validates. Structurally the text/element halves of the htmlDocComments
// Anchor union, redeclared here so the parent never trusts the frame to send a full Anchor.
export interface BridgeTextAnchor {
  kind: 'text'
  text: string
  context_before?: string
  context_after?: string
}
export interface BridgeElementAnchor {
  kind: 'element'
  aid: string
  selector: string
  label?: string
}
export type BridgeAnchor = BridgeTextAnchor | BridgeElementAnchor

const MAX_STR = 4096

function isBoundedString(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_STR
}

/**
 * Bound + validate an aid before it is interpolated into any selector. Hostile aids can contain
 * quotes/brackets/backslashes; we cap length and reject control chars so a malformed value can
 * never smuggle selector syntax past CSS.escape on either side of the bridge.
 */
export function isValidAid(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f]/.test(v)
}

/**
 * Parent's schema gate (run AFTER event.source === iframe.contentWindow). Enforces bounded
 * types so a forged frame payload can't smuggle an unexpected field or oversized string into
 * comment/selection state. Callers must additionally check `token` against the current render.
 */
export function parseBridgeInbound(data: unknown): BridgeInbound | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (m.channel !== BRIDGE_CHANNEL) return null
  if (!isBoundedString(m.token)) return null

  if (m.type === 'selection') {
    if (m.anchor === null) return { channel: BRIDGE_CHANNEL, type: 'selection', token: m.token, anchor: null }
    const anchor = parseBridgeAnchor(m.anchor)
    return anchor ? { channel: BRIDGE_CHANNEL, type: 'selection', token: m.token, anchor } : null
  }
  if (m.type === 'anchor-text') {
    if (!isBoundedString(m.nonce)) return null
    if (!(m.text === null || isBoundedString(m.text))) return null
    return { channel: BRIDGE_CHANNEL, type: 'anchor-text', token: m.token, nonce: m.nonce, text: m.text as string | null }
  }
  return null
}

/** Validate an untrusted anchor descriptor into the bounded text/element wire shape. */
export function parseBridgeAnchor(value: unknown): BridgeAnchor | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  if (a.kind === 'text') {
    if (!isBoundedString(a.text) || !a.text.trim()) return null
    const out: BridgeTextAnchor = { kind: 'text', text: a.text }
    if (isBoundedString(a.context_before)) out.context_before = a.context_before
    if (isBoundedString(a.context_after)) out.context_after = a.context_after
    return out
  }
  if (a.kind === 'element') {
    if (!isValidAid(a.aid)) return null
    if (!isBoundedString(a.selector)) return null
    const out: BridgeElementAnchor = { kind: 'element', aid: a.aid, selector: a.selector }
    if (isBoundedString(a.label)) out.label = a.label
    return out
  }
  return null
}

/** Fresh per-render correlation token. Not a secret; isolates stale/cross-generation replies. */
export function newBridgeToken(): string {
  const rnd = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(2)).join('-')
    : Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${rnd}`
}

/**
 * Body of the bridge script (no wrapping <script> tags). Relays UI facts to the parent only:
 * selections, element-text lookups, scroll+highlight. No network/parent access (opaque origin);
 * targetOrigin '*' (only non-secret facts posted). The embedded token is echoed/required so stale
 * generations drop; CSS.escape guards the bounded aid. Free of a literal `</script>` so it stays
 * inert-then-executable when DOMParser serializes it into srcDoc.
 */
export function buildBridgeScriptBody(token: string): string {
  const tokenLiteral = JSON.stringify(token)
  return `(function(){
  var CH = ${JSON.stringify(BRIDGE_CHANNEL)}, TOKEN = ${tokenLiteral};
  var CONTEXT = 40, LIMIT = 120, hlAnim = null;
  function esc(s){ try{ return CSS.escape(s); }catch(e){ return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); } }
  function trunc(s){ var a=Array.from(s); return a.length<=LIMIT ? s : a.slice(0,LIMIT).join('')+'\\u2026'; }
  function post(msg){ msg.channel = CH; msg.token = TOKEN; try{ parent.postMessage(msg, '*'); }catch(e){} }
  function findByAid(aid){
    if(typeof aid!=='string' || !aid || aid.length>256) return null;
    try{ return document.querySelector('[data-odoc-aid="'+esc(aid)+'"]'); }catch(e){ return null; }
  }
  function closestAid(node){
    var el = node && node.nodeType===1 ? node : (node && node.parentElement);
    while(el){ if(el.hasAttribute && el.hasAttribute('data-odoc-aid')) return el; el=el.parentElement; }
    return null;
  }
  function around(range, side){
    var c = side==='before' ? range.startContainer : range.endContainer;
    var full = c.textContent || '';
    if(side==='before'){ var e=range.startOffset; return full.slice(Math.max(0,e-CONTEXT), e).trim(); }
    var st=range.endOffset; return full.slice(st, st+CONTEXT).trim();
  }
  function anchorFromSelection(sel){
    if(!sel || sel.rangeCount===0 || sel.isCollapsed) return null;
    var text = sel.toString(); if(!text.trim()) return null;
    var range = sel.getRangeAt(0);
    var aidEl = closestAid(range.commonAncestorContainer);
    if(aidEl){ var aid=aidEl.getAttribute('data-odoc-aid'); return {kind:'element', aid:aid, selector:'[data-odoc-aid="'+esc(aid)+'"]', label:aidEl.tagName.toLowerCase()}; }
    var a={kind:'text', text:text}; var b=around(range,'before'), af=around(range,'after');
    if(b) a.context_before=b; if(af) a.context_after=af; return a;
  }
  // Non-destructive highlight: a Web Animations pulse that auto-restores. No injected CSS, no
  // forced-priority declarations, no hardcoded color — outline uses the doc's own currentColor.
  // Falls back to a scroll-only pulse when el.animate is unavailable, so styles are never mutated.
  function highlight(el){
    try{
      if(!el || typeof el.animate!=='function') return;
      if(hlAnim){ try{ hlAnim.cancel(); }catch(e){} }
      hlAnim = el.animate(
        [ {outline:'2px solid currentColor', outlineOffset:'2px'},
          {outline:'2px solid currentColor', outlineOffset:'2px', offset:0.85},
          {outline:'2px solid transparent', outlineOffset:'2px'} ],
        {duration:1600, easing:'ease-out'}
      );
    }catch(e){}
  }
  document.addEventListener('selectionchange', function(){
    var sel = document.getSelection ? document.getSelection() : null;
    var body = document.body;
    if(!sel || sel.rangeCount===0 || sel.isCollapsed || !body || !body.contains(sel.getRangeAt(0).commonAncestorContainer)){
      post({type:'selection', anchor:null}); return;
    }
    post({type:'selection', anchor: anchorFromSelection(sel)});
  });
  window.addEventListener('message', function(ev){
    if(ev.source !== parent) return;
    var d = ev.data; if(!d || d.channel!==CH || d.token!==TOKEN) return;
    if(d.type==='resolve-anchor-text' && typeof d.nonce==='string'){
      var el=findByAid(d.aid);
      var txt = el && el.textContent ? el.textContent.trim() : '';
      post({type:'anchor-text', nonce:d.nonce, text: txt ? trunc(txt) : null});
    } else if(d.type==='scroll-to-anchor'){
      var t=findByAid(d.aid);
      if(t){ if(t.scrollIntoView) t.scrollIntoView({block:'center'}); highlight(t); }
    }
  });
})();`
}

/** Bridge as a full <script> string (raw-HTML fallback path). buildBridgeScriptBody has no
 *  literal `</script>`, so wrapping is safe. */
export function buildBridgeScript(token: string): string {
  return `<script>${buildBridgeScriptBody(token)}<\/script>`
}

// Serialize a parsed document back to a string, preserving the doctype when present (mirrors
// absolutizeDocAssetUrls so the two DOMParser passes round-trip identically).
function serializeDoc(doc: Document): string {
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : ''
  return `${doctype}${doc.documentElement.outerHTML}`
}

// Fail-closed fallback for environments without DOMParser (SSR). We do NOT regex-guess where the
// <head> is: a raw-string match can be fooled by a fake <head> inside a comment/script/style/
// template, mis-placing (or double-injecting) the bridge and, worse, landing it AFTER an author
// <meta CSP>. Rather than risk unsafe/mis-ordered injection we disable the bridge and return the
// HTML unchanged. Browsers (the production + test render path) always have DOMParser, so this only
// affects non-DOM SSR, where the interactive bridge is not used anyway.
export function injectBridgeRaw(html: string, _token: string): string {
  return html
}

/**
 * Insert the product bridge (<script> only — the highlight is a Web Animations pulse, no injected
 * CSS) as the FIRST real <head> child, BEFORE any author <meta CSP> and author scripts (a CSP
 * governs only resources declared after it, so a first-child inline script survives an author
 * `script-src 'none'`). Parser-aware by construction: DOMParser never treats a fake `<head>` inside
 * raw-text/comment/template content as a tag, and normalizes malformed/fragment markup. The bridge
 * script's body carries no literal `</script>`, so it stays intact (and becomes executable in
 * srcDoc — intended) after serialize.
 * SSR (no DOMParser) fails closed: injectBridgeRaw returns the HTML unchanged (bridge disabled).
 * Use bridgeAvailable() to check whether injection is active in the current environment.
 */
export function bridgeAvailable(): boolean {
  return typeof DOMParser !== 'undefined'
}

export function injectBridgeScript(html: string, token: string): string {
  if (typeof DOMParser === 'undefined') return injectBridgeRaw(html, token)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const head = doc.head
  if (!head) return injectBridgeRaw(html, token)

  const script = doc.createElement('script')
  // textContent (not innerHTML) so the JS is not HTML-parsed; serialization emits real tags. The
  // body has no literal `</script>`, so no premature close on re-parse in srcDoc.
  script.textContent = buildBridgeScriptBody(token)

  // Prepend so the bridge precedes author <meta CSP> / author scripts already in <head>.
  head.insertBefore(script, head.firstChild)
  return serializeDoc(doc)
}
