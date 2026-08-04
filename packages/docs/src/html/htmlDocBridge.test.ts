import { describe, it, expect } from 'vitest'
import {
  BRIDGE_CHANNEL,
  parseBridgeInbound,
  parseBridgeAnchor,
  injectBridgeScript,
  bridgeAvailable,
  buildBridgeScript,
  buildBridgeScriptBody,
  isValidAid,
  newBridgeToken,
} from './htmlDocBridge.ts'

const TOK = 'tok-1'

// The doc script is UNTRUSTED and can forge any message shape. parseBridgeInbound is the parent's
// schema gate (after the event.source identity + token checks); it must accept only the bounded
// selection/anchor-text UI facts and reject everything else.
describe('parseBridgeInbound — untrusted message validation', () => {
  it('accepts a well-formed element selection', () => {
    const out = parseBridgeInbound({
      channel: BRIDGE_CHANNEL,
      type: 'selection',
      token: TOK,
      anchor: { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' },
    })
    expect(out).toMatchObject({ type: 'selection', token: TOK, anchor: { kind: 'element', aid: 'a1' } })
  })

  it('accepts a well-formed text selection and a null (clear) selection', () => {
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: { kind: 'text', text: 'hi' } }))
      .toMatchObject({ type: 'selection', anchor: { kind: 'text', text: 'hi' } })
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: null }))
      .toEqual({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: null })
  })

  it('accepts a bounded anchor-text reply', () => {
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: 'n1', text: 'quote' }))
      .toEqual({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: 'n1', text: 'quote' })
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: 'n1', text: null }))
      .toEqual({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: 'n1', text: null })
  })

  it('rejects wrong/absent channel and absent/oversized token', () => {
    expect(parseBridgeInbound({ channel: 'evil', type: 'selection', token: TOK, anchor: null })).toBeNull()
    expect(parseBridgeInbound({ type: 'selection', token: TOK, anchor: null })).toBeNull()
    // token is mandatory on the wire (the caller then equality-checks it against the render gen).
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', anchor: null })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: 'x'.repeat(5000), anchor: null })).toBeNull()
  })

  it('rejects unknown / privileged message types (no generic RPC)', () => {
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'fetch', token: TOK, url: 'https://evil' })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'navigate', token: TOK, to: '/' })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'eval', token: TOK, code: '1' })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, token: TOK })).toBeNull()
  })

  it('rejects malformed / non-object / oversized payloads', () => {
    expect(parseBridgeInbound(null)).toBeNull()
    expect(parseBridgeInbound('string')).toBeNull()
    expect(parseBridgeInbound(42)).toBeNull()
    const big = 'x'.repeat(5000)
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: big, text: 'ok' })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'anchor-text', token: TOK, nonce: 'n', text: big })).toBeNull()
    expect(
      parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: { kind: 'text', text: big } })
    ).toBeNull()
  })

  it('rejects a selection whose anchor is structurally invalid', () => {
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: { kind: 'element' } })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: { kind: 'text', text: '   ' } })).toBeNull()
    expect(parseBridgeInbound({ channel: BRIDGE_CHANNEL, type: 'selection', token: TOK, anchor: { kind: 'lost' } })).toBeNull()
  })
})

describe('isValidAid — bounded aid guard', () => {
  it('accepts a plausible aid and rejects empty/oversized/control-char values', () => {
    expect(isValidAid('a1')).toBe(true)
    expect(isValidAid('el-42_x')).toBe(true)
    expect(isValidAid('')).toBe(false)
    expect(isValidAid('x'.repeat(257))).toBe(false)
    expect(isValidAid('a\u0000b')).toBe(false)
    expect(isValidAid('a\nb')).toBe(false)
    expect(isValidAid(123 as unknown)).toBe(false)
  })

  it('a hostile aid with selector metacharacters is still bounded (escaping happens at the selector)', () => {
    // A short hostile value is a valid string here; it must be CSS.escape-d before use in a
    // selector (see buildBridgeScript / resolveHtmlDocAnchorText), which the frame does.
    expect(isValidAid('"] , script')).toBe(true)
  })

  it('accepts Object.prototype key names as aids (Map own-key semantics make them safe)', () => {
    // aids double as parent Map cache keys; a Map never walks the prototype chain, so these names
    // are safe own keys. Rejecting them would wrongly drop legitimate ids that happen to collide.
    for (const aid of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(isValidAid(aid)).toBe(true)
    }
  })
})

describe('parseBridgeAnchor', () => {
  it('drops unexpected fields, keeping only the bounded wire shape', () => {
    const out = parseBridgeAnchor({
      kind: 'element',
      aid: 'a1',
      selector: 's',
      label: 'p',
      onclick: 'alert(1)',
      __proto__polluter: true,
    })
    expect(out).toEqual({ kind: 'element', aid: 'a1', selector: 's', label: 'p' })
  })

  it('rejects an element anchor with a control-char / oversized aid', () => {
    expect(parseBridgeAnchor({ kind: 'element', aid: 'a\u0000', selector: 's' })).toBeNull()
    expect(parseBridgeAnchor({ kind: 'element', aid: 'x'.repeat(300), selector: 's' })).toBeNull()
  })

  it('accepts an element anchor whose aid is an Object.prototype key name (Map-safe)', () => {
    for (const aid of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(parseBridgeAnchor({ kind: 'element', aid, selector: 's' })).toEqual({
        kind: 'element',
        aid,
        selector: 's',
      })
    }
  })
})

describe('newBridgeToken', () => {
  it('produces distinct non-empty tokens', () => {
    const a = newBridgeToken()
    const b = newBridgeToken()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })
})

// Parser-aware injection (issue #27 reviewer finding). Built on DOMParser so fake <head> strings in
// raw-text/comment/template content are never matched, malformed/fragment markup normalizes, the
// bridge lands as the first real <head> child (before author meta CSP / author scripts), the
// doctype and body survive, and the serialized bridge stays inert-then-executable safely.
describe('injectBridgeScript — parser-aware CSP ordering & malformed HTML', () => {
  it('injects the bridge as the first head content, BEFORE an author meta CSP', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><title>t</title></head><body><p>x</p></body></html>'
    const out = injectBridgeScript(html, TOK)
    const bridgeAt = out.indexOf('octodoc-bridge')
    const cspAt = out.indexOf('Content-Security-Policy')
    expect(bridgeAt).toBeGreaterThan(-1)
    expect(bridgeAt).toBeLessThan(cspAt)
    expect(out).toContain("script-src 'none'")
    // Body content is preserved.
    expect(out).toContain('<p>x</p>')
  })

  it('embeds the per-render token and keeps the bridge before the author CSP', () => {
    const out = injectBridgeScript('<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body>', TOK)
    expect(out).toContain(`TOKEN = "${TOK}"`)
    expect(out).toContain("default-src 'self'")
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('Content-Security-Policy'))
  })

  it('is the FIRST head child, before an author script already in <head> (author JS still present)', () => {
    const html = '<html><head><script>window.__author=1<\/script></head><body></body></html>'
    const out = injectBridgeScript(html, TOK)
    // Bridge precedes the author script.
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('window.__author=1'))
    // Author script is preserved (executes when srcDoc re-parses).
    expect(out).toContain('window.__author=1')
  })

  it('synthesizes a <head> when the document has only a body (bridge precedes body CSP)', () => {
    const out = injectBridgeScript('<html><body><meta http-equiv="Content-Security-Policy" content="x"><p>x</p></body></html>', TOK)
    expect(out).toContain('<head>')
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('Content-Security-Policy'))
    expect(out).toContain('<p>x</p>')
  })

  it('normalizes a bare fragment into a document with the bridge in <head> and the fragment in <body>', () => {
    // DOMParser puts a fragment in <body> and synthesizes <head>; the bridge lands in that head.
    const out = injectBridgeScript('<p>bare fragment</p>', TOK)
    expect(out).toContain('octodoc-bridge')
    expect(out).toContain('<p>bare fragment</p>')
    // Bridge (in head) precedes the fragment (in body).
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('bare fragment'))
  })

  it('does NOT treat a fake <head> in TEXT / an HTML comment as a real tag', () => {
    // A visible "<head>" string and a commented-out <head> must not be matched as the head anchor.
    const html =
      '<head><title>&lt;head&gt; shown as text</title></head><body><!-- <head>fake</head> --><p>&lt;/head&gt; text</p></body>'
    const out = injectBridgeScript(html, TOK)
    // Exactly one real bridge injection, before the real <title>.
    expect(out.split('octodoc-bridge').length - 1).toBe(1)
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain('shown as text')
  })

  it('does NOT treat a <head> inside a <template> as the document head', () => {
    // <template> content is inert/parsed as a separate fragment; the real head is the anchor.
    const html = '<head><meta charset="utf-8"></head><body><template><head>nope</head></template><p>x</p></body>'
    const out = injectBridgeScript(html, TOK)
    expect(out.split('octodoc-bridge').length - 1).toBe(1)
    // Bridge precedes the real <meta charset>, i.e. it went into the document head, not the template.
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('<meta charset'))
    expect(out).toContain('<template>')
  })

  it('does NOT treat a fake </head> inside a <script>/<style> raw-text element as a tag', () => {
    const html =
      '<head><style>/* </head> */ .a{color:red}</style><script>var s="</head>";<\/script></head><body><p>x</p></body>'
    const out = injectBridgeScript(html, TOK)
    expect(out.split('octodoc-bridge').length - 1).toBe(1)
    // The bridge is first — before the author style/script that contain the fake </head> text.
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('color:red'))
    // Author raw-text content is preserved verbatim.
    expect(out).toContain('.a{color:red}')
  })

  it('tolerates malformed markup (unclosed tags) and still injects one bridge', () => {
    const out = injectBridgeScript('<html><head><meta charset="utf-8"><body><p>oops no head close', TOK)
    expect(out.split('octodoc-bridge').length - 1).toBe(1)
    expect(out).toContain('<p>oops no head close</p>')
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('<meta charset'))
  })

  it('preserves a leading doctype', () => {
    const out = injectBridgeScript('<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>', TOK)
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true)
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('<title>'))
  })

  it('tolerates a <head> with attributes', () => {
    const out = injectBridgeScript('<head data-x="1"><meta charset="utf-8"></head><body></body>', TOK)
    expect(out.indexOf('octodoc-bridge')).toBeLessThan(out.indexOf('<meta charset'))
    expect(out).toContain('data-x="1"')
  })

  it('serializes the bridge script inert-safe: no literal </script> in the body, present after re-parse', () => {
    // A literal </script> in the bridge body would prematurely close it when srcDoc re-parses. The
    // body must contain none, yet the serialized document must carry a real closing </script>.
    expect(buildBridgeScriptBody(TOK)).not.toMatch(/<\/script/i)
    const out = injectBridgeScript('<head></head><body><p>x</p></body>', TOK)
    expect(out).toMatch(/<script>[\s\S]*octodoc-bridge[\s\S]*<\/script>/i)
  })
})

describe('injectBridgeScript — fail-closed SSR fallback (no DOMParser)', () => {
  it('returns the HTML unchanged and does NOT regex-guess a fake <head> in comment/CSP content', () => {
    const realDOMParser = globalThis.DOMParser
    // Simulate a non-DOM (SSR) environment.
    ;(globalThis as { DOMParser?: unknown }).DOMParser = undefined
    try {
      expect(bridgeAvailable()).toBe(false)
      // Fake <head> hidden inside a comment + a restrictive author CSP. A regex fallback could match
      // the fake tag and land the bridge AFTER the CSP (unsafe) or double-inject; fail-closed must not.
      const html =
        '<!-- <head>fake</head> -->' +
        '<head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><title>t</title></head>' +
        '<body><p>x</p></body>'
      const out = injectBridgeScript(html, TOK)
      // Unchanged: no bridge injected, so no unsafe/mis-ordered script and nothing before the CSP.
      expect(out).toBe(html)
      expect(out).not.toContain('octodoc-bridge')
      expect(out).not.toContain(TOK)
    } finally {
      ;(globalThis as { DOMParser?: unknown }).DOMParser = realDOMParser
    }
    // Normal DOMParser path is restored and unchanged.
    expect(bridgeAvailable()).toBe(true)
    const ok = injectBridgeScript('<head><title>t</title></head><body></body>', TOK)
    expect(ok).toContain('octodoc-bridge')
  })

  it('bridgeAvailable() reflects DOMParser presence', () => {
    expect(bridgeAvailable()).toBe(true)
  })
})

describe('highlight — no injected CSS, no !important, no hardcoded color (UI-SPEC)', () => {
  it('injects no <style> and the serialized document carries no !important / arbitrary hex color', () => {
    const out = injectBridgeScript('<head></head><body><p>x</p></body>', TOK)
    // The temporary highlight is a Web Animations pulse, so no product stylesheet is injected.
    expect(out).not.toContain('octodoc-anchor-hl')
    expect(out).not.toContain('!important')
    // No hardcoded arbitrary highlight color leaked into the doc.
    expect(out.toLowerCase()).not.toContain('#f5a623')
    expect(out.toLowerCase()).not.toContain('rgba(245,166,35')
  })

  it('bridge body highlights via el.animate + currentColor (no hardcoded color, no !important)', () => {
    const body = buildBridgeScriptBody(TOK)
    expect(body).toContain('el.animate')
    expect(body).toContain('currentColor')
    expect(body).not.toContain('!important')
    // No injected highlight stylesheet / class-toggle scheme.
    expect(body).not.toContain('octodoc-anchor-hl')
    // No arbitrary hardcoded color literal.
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})

describe('buildBridgeScript — self-contained, non-privileged relay', () => {
  it('only talks to parent, never grants a generic RPC, and CSS.escapes aids', () => {
    const s = buildBridgeScript(TOK)
    expect(s).toContain('parent.postMessage')
    expect(s).not.toMatch(/\bfetch\(/)
    expect(s).not.toMatch(/XMLHttpRequest/)
    // Gates inbound on parent identity AND the render token.
    expect(s).toContain('ev.source !== parent')
    expect(s).toContain('d.token!==TOKEN')
    // Only the two UI-fact verbs — no eval/navigation/privileged actions.
    expect(s).toContain('resolve-anchor-text')
    expect(s).toContain('scroll-to-anchor')
    expect(s).not.toMatch(/\beval\(/)
    // Hostile aids are escaped before entering any selector.
    expect(s).toContain('CSS.escape')
    // Every reply carries the token so a stale generation is discarded by the parent.
    expect(s).toContain('msg.token = TOKEN')
  })
})
