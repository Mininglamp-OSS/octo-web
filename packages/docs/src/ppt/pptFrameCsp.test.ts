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

describe('withFrameCsp — inject the CSP meta at the head of the deck', () => {
  const cspMeta = /<meta http-equiv="Content-Security-Policy"/i

  it('inserts the meta just inside an existing <head>', () => {
    const out = withFrameCsp('<html><head><title>Deck</title></head><body>slides</body></html>')
    expect(out).toMatch(cspMeta)
    // The meta must precede the deck's own head content so it governs before any script runs.
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain('slides')
  })

  it('opens a <head> right after <html> when the deck has none', () => {
    const out = withFrameCsp('<html><body>slides</body></html>')
    expect(out).toMatch(cspMeta)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<body>'))
    expect(out).toContain('slides')
  })

  it('prepends the meta for a bare fragment (implicit head)', () => {
    const out = withFrameCsp('<section>just a fragment</section>')
    expect(out).toMatch(cspMeta)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<section>'))
    expect(out).toContain('just a fragment')
  })

  it('does not treat `$` sequences in the deck HTML as replacement patterns', () => {
    const out = withFrameCsp('<html><head></head><body>price $1 & $&$`</body></html>')
    expect(out).toContain('price $1 & $&$`')
  })
})
