import { describe, it, expect, afterEach } from 'vitest'
import { buildAnchorFromSelection, buildAgentInstruction } from './htmlDocAnchor.ts'

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

/** Select the full text content of an element and return the live Selection. */
function selectContents(el: Node): Selection {
  const sel = window.getSelection() as Selection
  sel.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(el)
  sel.addRange(range)
  return sel
}

describe('buildAnchorFromSelection', () => {
  it('returns null when nothing is selected (collapsed)', () => {
    const sel = window.getSelection() as Selection
    sel.removeAllRanges()
    expect(buildAnchorFromSelection(sel)).toBeNull()
  })

  it('returns null for a null selection', () => {
    expect(buildAnchorFromSelection(null)).toBeNull()
  })

  it('builds an ELEMENT anchor when the selection is inside a data-odoc-aid element', () => {
    document.body.innerHTML = '<div><p data-odoc-aid="a7">hello world</p></div>'
    const p = document.querySelector('p') as HTMLElement
    const anchor = buildAnchorFromSelection(selectContents(p.firstChild as Node))
    expect(anchor).toEqual({
      kind: 'element',
      aid: 'a7',
      selector: '[data-odoc-aid="a7"]',
      label: 'p',
    })
  })

  it('walks up to the nearest aid ancestor for a deep selection', () => {
    document.body.innerHTML =
      '<section data-odoc-aid="sec1"><span>deep <em>text</em></span></section>'
    const em = document.querySelector('em') as HTMLElement
    const anchor = buildAnchorFromSelection(selectContents(em.firstChild as Node))
    expect(anchor).toMatchObject({ kind: 'element', aid: 'sec1', label: 'section' })
  })

  it('CSS.escapes a hostile aid so the selector cannot break out', () => {
    // A hostile aid with a quote/bracket must produce a valid, escaped attribute selector that
    // still matches ONLY the intended element (querySelector must not throw and must resolve it).
    const hostile = '"] , script'
    const el = document.createElement('p')
    el.setAttribute('data-odoc-aid', hostile)
    el.textContent = 'x'
    document.body.appendChild(el)
    const anchor = buildAnchorFromSelection(selectContents(el.firstChild as Node))
    expect(anchor?.kind).toBe('element')
    if (anchor?.kind === 'element') {
      expect(anchor.aid).toBe(hostile)
      // The escaped selector round-trips: it matches exactly the hostile element and nothing throws.
      expect(() => document.querySelector(anchor.selector)).not.toThrow()
      expect(document.querySelector(anchor.selector)).toBe(el)
    }
  })

  it('builds a TEXT anchor with the selected text when no aid is present', () => {
    document.body.innerHTML = '<div><p>just plain text here</p></div>'
    const p = document.querySelector('p') as HTMLElement
    const anchor = buildAnchorFromSelection(selectContents(p.firstChild as Node))
    expect(anchor).toMatchObject({ kind: 'text', text: 'just plain text here' })
  })

  it('captures surrounding context for a partial text selection', () => {
    document.body.innerHTML = '<p>alpha beta gamma delta</p>'
    const textNode = (document.querySelector('p') as HTMLElement).firstChild as Text
    const sel = window.getSelection() as Selection
    sel.removeAllRanges()
    const range = document.createRange()
    // select "beta" (chars 6..10)
    range.setStart(textNode, 6)
    range.setEnd(textNode, 10)
    sel.addRange(range)
    const anchor = buildAnchorFromSelection(sel)
    expect(anchor).toMatchObject({ kind: 'text', text: 'beta' })
    if (anchor?.kind === 'text') {
      expect(anchor.context_before).toContain('alpha')
      expect(anchor.context_after).toContain('gamma')
    }
  })
})

describe('buildAgentInstruction', () => {
  it('embeds doc identity + comment content for an element-anchored comment', () => {
    const { title, link } = buildAgentInstruction(
      { docId: 'd1', slug: 'the-slug', version: 'v3' },
      { id: 'c9', text: '把这段改成更正式', anchor: { kind: 'element', aid: 'a7', selector: '[data-odoc-aid="a7"]' } },
    )
    // Title (human-readable): doc + request + target.
    expect(title).toContain('把这段改成更正式')
    expect(title).toContain('the-slug')
    // Link (machine-parseable): doc identity + comment + anchor.
    expect(link).toContain('docId=d1')
    expect(link).toContain('slug=the-slug')
    expect(link).toContain('commentId=c9')
    expect(link).toContain('aid=a7')
    expect(link).toContain('version=v3')
    expect(link).toContain('action=agent-handle-comment')
  })

  it('encodes anchorText for a text-anchored comment and falls back to docId as slug', () => {
    const { title, link } = buildAgentInstruction(
      { docId: 'd2' },
      { id: 'c1', text: 'clarify this', anchor: { kind: 'text', text: 'foo bar' } },
    )
    expect(title).toContain('d2')
    expect(link).toContain('slug=d2')
    expect(link).toContain('anchorText=foo+bar')
    expect(link).toContain('request=clarify+this')
  })

  it('handles a doc-level comment with no anchor', () => {
    const { title, link } = buildAgentInstruction(
      { docId: 'd3' },
      { id: 'c2', text: 'overall too long' },
    )
    expect(title).toContain('whole-doc')
    expect(link).toContain('commentId=c2')
    expect(link).not.toContain('aid=')
  })
})
