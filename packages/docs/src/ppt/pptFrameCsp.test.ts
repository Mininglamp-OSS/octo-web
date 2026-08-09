import { describe, it, expect } from 'vitest'
import { PPT_FRAME_CSP, withFrameCsp } from './pptFrameCsp.ts'

// P1-2 (XIN-1621): the opaque Bento frame is hardened with a srcdoc CSP meta that denies outbound
// connections (fetch-exfiltration containment) while still allowing the self-contained Bento runtime.
describe('PPT_FRAME_CSP — the srcdoc frame policy', () => {
  it('denies connect-src (the exfiltration containment)', () => {
    expect(PPT_FRAME_CSP).toContain("connect-src 'none'")
  })

  it('allows the self-contained Bento runtime (inline/eval scripts, data/blob media & fonts)', () => {
    expect(PPT_FRAME_CSP).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:")
    expect(PPT_FRAME_CSP).toContain('img-src data: blob:')
    expect(PPT_FRAME_CSP).toContain('font-src data: blob:')
    expect(PPT_FRAME_CSP).toContain('media-src data: blob:')
  })

  it('closes the base-tag and form-POST exfil side-channels', () => {
    expect(PPT_FRAME_CSP).toContain("base-uri 'none'")
    expect(PPT_FRAME_CSP).toContain("form-action 'none'")
  })
})

// Re-parse withFrameCsp's OUTPUT exactly as the browser would parse the srcdoc, and assert the CSP meta
// is the FIRST element child of the real <head>. That is the only placement that governs the document
// before any deck script runs; a control that is not first-in-head is not a control.
const CSP_SELECTOR = 'meta[http-equiv="Content-Security-Policy" i]'
function reparse(out: string): Document {
  return new DOMParser().parseFromString(out, 'text/html')
}
function cspMetas(doc: Document): NodeListOf<HTMLMetaElement> {
  return doc.querySelectorAll<HTMLMetaElement>(CSP_SELECTOR)
}

describe('withFrameCsp — inject the CSP meta as the first real-head child', () => {
  const cspMeta = /<meta http-equiv="Content-Security-Policy"/i

  it('inserts the meta just inside an existing <head>', () => {
    const out = withFrameCsp('<html><head><title>Deck</title></head><body>slides</body></html>')
    expect(out).toMatch(cspMeta)
    // The meta must precede the deck's own head content so it governs before any script runs.
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain('slides')
    const doc = reparse(out)
    expect(cspMetas(doc)).toHaveLength(1)
    expect(doc.head.firstElementChild).toBe(cspMetas(doc)[0])
  })

  it('opens a <head> right after <html> when the deck has none', () => {
    const out = withFrameCsp('<html><body>slides</body></html>')
    expect(out).toMatch(cspMeta)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<body>'))
    expect(out).toContain('slides')
    const doc = reparse(out)
    expect(doc.head.firstElementChild).toBe(cspMetas(doc)[0])
  })

  it('prepends the meta for a bare fragment (implicit head)', () => {
    const out = withFrameCsp('<section>just a fragment</section>')
    expect(out).toMatch(cspMeta)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<section>'))
    expect(out).toContain('just a fragment')
    const doc = reparse(out)
    expect(doc.head.firstElementChild).toBe(cspMetas(doc)[0])
  })

  it('preserves the deck doctype (no quirks-mode regression on re-serialization)', () => {
    const out = withFrameCsp('<!DOCTYPE html><html><head></head><body>slides</body></html>')
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true)
    expect(reparse(out).compatMode).toBe('CSS1Compat') // standards mode, not quirks
  })

  it('does not treat `$` sequences in deck content as replacement patterns', () => {
    // The parse-based injection never runs String.prototype.replace over the deck, so `$&`/`$\`` — the
    // sequences that were special to a replacer — are inert plain text here.
    const out = withFrameCsp('<html><head></head><body>cost $1 $$ $` done</body></html>')
    expect(out).toContain('cost $1 $$ $` done')
  })

  // P1-1 (XIN-1630): the CSP is a containment against the DECK AUTHOR, so it must survive an author who
  // crafts the HTML to displace a naive textual `<head>` injection. Each vector below fails OPEN under
  // regex surgery (the meta lands in a comment / after a hoisted script / inside an attribute); the
  // parse-based injection makes each fail CLOSED — the meta re-parses as the first real-head child.
  describe('adversarial: fails CLOSED against deck-author bypass vectors', () => {
    it('(a) a <head> inside a leading comment does not displace the meta', () => {
      // A textual match on the earliest `<head>` — here inside the comment — would inject the meta INTO
      // the comment (commented out, no CSP). Parsing treats the comment as a comment.
      const out = withFrameCsp(
        '<!-- <head> --><html><head><title>T</title></head><body>slides</body></html>',
      )
      const doc = reparse(out)
      expect(cspMetas(doc)).toHaveLength(1)
      expect(doc.head.firstElementChild).toBe(cspMetas(doc)[0])
      expect(doc.body.textContent).toContain('slides')
    })

    it('(b) a <script> before <head> is hoisted into head AFTER the meta', () => {
      // HTML tree construction hoists a pre-<head> <script> into an implicit head and ignores the later
      // literal <head>. A textual injection into that later <head> lands after the running script (fail
      // OPEN); parsing puts the meta first, so the hoisted script is governed (fail CLOSED).
      const out = withFrameCsp(
        '<html><script>window.__exfil=1</script><head><title>T</title></head><body>x</body></html>',
      )
      const doc = reparse(out)
      const meta = cspMetas(doc)[0]
      expect(cspMetas(doc)).toHaveLength(1)
      expect(doc.head.firstElementChild).toBe(meta)
      const script = doc.head.querySelector('script')
      expect(script).not.toBeNull()
      // The meta precedes the deck script in the head, so the CSP is installed before it could run.
      expect(meta.compareDocumentPosition(script!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('(c) a <head` inside a quoted attribute value does not displace the meta', () => {
      // A textual match on the `<head>` inside the attribute value would inject the meta into the
      // attribute (no CSP + corrupted tag). Parsing keeps it as attribute text.
      const out = withFrameCsp(
        '<html><head></head><body><div title="<head>">hi</div></body></html>',
      )
      const doc = reparse(out)
      expect(cspMetas(doc)).toHaveLength(1)
      expect(doc.head.firstElementChild).toBe(cspMetas(doc)[0])
      // The attribute-embedded `<head>` stayed text on the div; it never became a second head/meta site.
      expect(doc.querySelector('div')?.getAttribute('title')).toBe('<head>')
      expect(doc.body.textContent).toContain('hi')
    })
  })
})
