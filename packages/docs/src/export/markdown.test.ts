import { describe, it, expect, vi } from 'vitest'
import {
  exportDocToMarkdown,
  collectAttachIds,
  type MdNode,
  type ExportOptions,
} from './markdown.ts'
import type { ResolveResult } from '../attachments/api.ts'

// Resolve stub: every id resolves to a deterministic signed URL except 'missing',
// which lands in notFound (so the exporter must degrade gracefully).
function makeResolve() {
  const calls: string[][] = []
  const resolve: ExportOptions['resolve'] = async (_docId, ids): Promise<ResolveResult> => {
    calls.push(ids)
    return {
      items: ids
        .filter((id) => id !== 'missing')
        .map((id) => ({
          attachId: id,
          url: `https://signed.example.com/${id}?sig=fresh`,
          expiresInSec: 300,
          mime: 'image/png',
          sizeBytes: 10,
          fileName: `${id}.bin`,
        })),
      notFound: ids.filter((id) => id === 'missing'),
    }
  }
  return { resolve, calls }
}

function doc(...content: MdNode[]): MdNode {
  return { type: 'doc', content }
}
function p(...content: MdNode[]): MdNode {
  return { type: 'paragraph', content }
}
function text(t: string, marks?: MdNode['marks']): MdNode {
  return { type: 'text', text: t, marks }
}

async function md(node: MdNode, opts?: ExportOptions): Promise<string> {
  const { resolve } = makeResolve()
  return exportDocToMarkdown('d_1', node, { resolve, ...opts })
}

describe('exportDocToMarkdown — header + structure', () => {
  it('prepends the signed-link warning comment', async () => {
    const out = await md(doc(p(text('hi'))))
    // The warning is localized via the `docs` namespace; the @octo/base test stub returns
    // the i18n key unchanged, so we assert on the stable key-based comment here.
    expect(out.startsWith('<!-- docs.toolbar.exportSignedLinkNotice -->')).toBe(true)
    expect(out).toContain('hi')
  })

  it('headings map to # … ######', async () => {
    const out = await md(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('H1')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('H3')] },
      ),
    )
    expect(out).toContain('# H1')
    expect(out).toContain('### H3')
  })
})

describe('exportDocToMarkdown — lists', () => {
  it('bullet and ordered lists', async () => {
    const li = (t: string): MdNode => ({ type: 'listItem', content: [p(text(t))] })
    const out = await md(
      doc(
        { type: 'bulletList', content: [li('a'), li('b')] },
        { type: 'orderedList', content: [li('one'), li('two')] },
      ),
    )
    expect(out).toContain('- a')
    expect(out).toContain('- b')
    expect(out).toContain('1. one')
    expect(out).toContain('2. two')
  })

  it('ordered list honours the start attr', async () => {
    const li = (t: string): MdNode => ({ type: 'listItem', content: [p(text(t))] })
    const out = await md(
      doc(
        { type: 'orderedList', attrs: { start: 3 }, content: [li('three'), li('four')] },
      ),
    )
    expect(out).toContain('3. three')
    expect(out).toContain('4. four')
    expect(out).not.toContain('1. three')
  })

  it('task list checked / unchecked', async () => {
    const out = await md(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('todo'))] },
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
        ],
      }),
    )
    expect(out).toContain('- [ ] todo')
    expect(out).toContain('- [x] done')
  })

  it('escapes a literal leading list marker in paragraph text (no spurious nested list)', async () => {
    const li = (t: string): MdNode => ({ type: 'listItem', content: [p(text(t))] })
    const out = await md(
      doc({ type: 'bulletList', content: [li('Bullet item one'), li('- Bullet item two')] }),
    )
    // The second item's literal "- " text must be escaped so it is not re-parsed as a
    // nested marker (`- - Bullet item two`).
    expect(out).toContain('- \\- Bullet item two')
    expect(out).not.toContain('- - Bullet item two')
  })

  it('escapes leading markdown markers in a top-level paragraph', async () => {
    const out = await md(
      doc(
        p(text('- not a bullet')),
        p(text('# not a heading')),
        p(text('1. not ordered')),
        p(text('2) not ordered either')),
        p(text('> not a quote')),
      ),
    )
    expect(out).toContain('\\- not a bullet')
    expect(out).toContain('\\# not a heading')
    // Ordered-list markers escape the punctuation, not the digit (CommonMark form).
    expect(out).toContain('1\\. not ordered')
    expect(out).toContain('2\\) not ordered either')
    expect(out).not.toContain('\\1.')
    expect(out).toContain('\\> not a quote')
  })

  it('does not escape markers that are mid-line (only line-leading)', async () => {
    const out = await md(doc(p(text('a - b and c # d'))))
    expect(out).toContain('a - b and c # d')
    expect(out).not.toContain('\\-')
    expect(out).not.toContain('\\#')
  })

  it('skips an empty list item instead of emitting a bare dangling marker', async () => {
    const li = (t: string): MdNode => ({ type: 'listItem', content: [p(text(t))] })
    const empty: MdNode = { type: 'listItem', content: [p()] }
    const out = await md(
      doc({ type: 'bulletList', content: [li('real item'), empty] }),
    )
    expect(out).toContain('- real item')
    // No trailing bare "- " line.
    expect(out.split('\n').some((l) => l.trim() === '-')).toBe(false)
    expect(out).not.toMatch(/- *$/m)
  })
})

describe('exportDocToMarkdown — blocks', () => {
  it('blockquote prefixes each line', async () => {
    const out = await md(doc({ type: 'blockquote', content: [p(text('quoted'))] }))
    expect(out).toContain('> quoted')
  })

  it('code block emits a fenced block with the language attr', async () => {
    const out = await md(
      doc({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [text('const x = 1')],
      }),
    )
    expect(out).toContain('```typescript\nconst x = 1\n```')
  })

  it('horizontal rule maps to ---', async () => {
    const out = await md(doc({ type: 'horizontalRule' }))
    expect(out).toContain('---')
  })

  it('math block / inline math', async () => {
    const out = await md(
      doc(
        { type: 'blockMath', attrs: { latex: 'a^2+b^2' } },
        p(text('x = '), { type: 'inlineMath', attrs: { latex: 'y' } }),
      ),
    )
    expect(out).toContain('$$\na^2+b^2\n$$')
    expect(out).toContain('x = $y$')
  })

  it('callout falls back to inline HTML and keeps its content', async () => {
    const out = await md(
      doc({ type: 'callout', attrs: { variant: 'warning' }, content: [p(text('careful'))] }),
    )
    expect(out).toContain('<div data-callout data-variant="warning">')
    expect(out).toContain('careful')
  })
})

describe('exportDocToMarkdown — tables', () => {
  const cell = (type: string, t: string, attrs?: Record<string, unknown>): MdNode => ({
    type,
    attrs,
    content: [p(text(t))],
  })
  const row = (...cells: MdNode[]): MdNode => ({ type: 'tableRow', content: cells })

  it('plain table → GFM pipe table with a header separator', async () => {
    const out = await md(
      doc({
        type: 'table',
        content: [
          row(cell('tableHeader', 'A'), cell('tableHeader', 'B')),
          row(cell('tableCell', '1'), cell('tableCell', '2')),
        ],
      }),
    )
    expect(out).toContain('| A | B |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| 1 | 2 |')
    expect(out).not.toContain('<table>')
  })

  it('merged cells (colspan/rowspan) → inline HTML table fallback', async () => {
    const out = await md(
      doc({
        type: 'table',
        content: [
          row(cell('tableHeader', 'Span', { colspan: 2 })),
          row(cell('tableCell', '1'), cell('tableCell', '2')),
        ],
      }),
    )
    expect(out).toContain('<table>')
    expect(out).toContain('<th colspan="2">Span</th>')
  })
})

describe('exportDocToMarkdown — attachments use fresh signed URLs', () => {
  it('image (RES-4): collects the durable attachId, not the stale src, and uses the fresh url', async () => {
    const node = doc({
      type: 'image',
      attrs: { attachId: 'img1', src: 'https://stale.example.com/old', alt: 'pic', title: 'cap' },
    })
    expect(collectAttachIds(node)).toEqual(['img1'])
    const out = await md(node)
    expect(out).toContain('![pic](https://signed.example.com/img1?sig=fresh "cap")')
    expect(out).not.toContain('stale.example.com')
  })

  it('file attachment resolves to a download link; notFound degrades without crashing', async () => {
    const out = await md(
      doc(
        { type: 'fileAttachment', attrs: { attachId: 'file1', fileName: 'report.pdf' } },
        { type: 'fileAttachment', attrs: { attachId: 'missing', fileName: 'gone.pdf' } },
      ),
    )
    expect(out).toContain('[report.pdf](https://signed.example.com/file1?sig=fresh)')
    expect(out).toContain('[gone.pdf]()')
    expect(out).toContain('attachment unavailable')
  })

  it('bookmark uses its external url as-is (never resolved)', async () => {
    const out = await md(
      doc({ type: 'bookmark', attrs: { url: 'https://example.org', title: 'Example' } }),
    )
    expect(out).toContain('[Example](https://example.org)')
  })

  it('chunks attachId resolution into batches of <= 200', async () => {
    const images: MdNode[] = []
    for (let i = 0; i < 250; i++) {
      images.push({ type: 'image', attrs: { attachId: `a${i}` } })
    }
    const { resolve, calls } = makeResolve()
    const spy = vi.fn(resolve)
    await exportDocToMarkdown('d_1', doc(...images), { resolve: spy, batchSize: 200 })
    expect(calls.length).toBe(2)
    expect(calls[0].length).toBe(200)
    expect(calls[1].length).toBe(50)
    expect(calls.every((c) => c.length <= 200)).toBe(true)
  })
})

describe('exportDocToMarkdown — inline marks and atoms', () => {
  it('bold / italic / code / strike / link', async () => {
    const out = await md(
      doc(
        p(
          text('b', [{ type: 'bold' }]),
          text('i', [{ type: 'italic' }]),
          text('c', [{ type: 'code' }]),
          text('s', [{ type: 'strike' }]),
          text('l', [{ type: 'link', attrs: { href: 'https://x.io' } }]),
        ),
      ),
    )
    expect(out).toContain('**b**')
    expect(out).toContain('*i*')
    expect(out).toContain('`c`')
    expect(out).toContain('~~s~~')
    expect(out).toContain('[l](https://x.io)')
  })

  it('underline / highlight / color → HTML fallback', async () => {
    const out = await md(
      doc(
        p(
          text('u', [{ type: 'underline' }]),
          text('h', [{ type: 'highlight' }]),
          text('col', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]),
          text('sup', [{ type: 'superscript' }]),
          text('sub', [{ type: 'subscript' }]),
        ),
      ),
    )
    expect(out).toContain('<u>u</u>')
    expect(out).toContain('<mark>h</mark>')
    expect(out).toContain('<span style="color:#ff0000">col</span>')
    expect(out).toContain('<sup>sup</sup>')
    expect(out).toContain('<sub>sub</sub>')
  })

  it('highlight with a colour keeps its background-color in the <mark> style', async () => {
    const out = await md(
      doc(
        p(
          text('hl', [{ type: 'highlight', attrs: { color: '#ffeb3b' } }]),
        ),
      ),
    )
    expect(out).toContain('<mark style="background-color:#ffeb3b">hl</mark>')
  })

  it('colourless highlight degrades to a bare <mark>', async () => {
    const out = await md(doc(p(text('h', [{ type: 'highlight' }]))))
    expect(out).toContain('<mark>h</mark>')
    expect(out).not.toContain('style=')
  })

  it('malicious highlight colour is escaped inside the style attribute (no breakout)', async () => {
    const out = await md(
      doc(
        p(
          text('x', [
            { type: 'highlight', attrs: { color: '"><img src=x onerror=alert(1)>' } },
          ]),
        ),
      ),
    )
    // The `"` and `<`/`>` are entity-escaped so the value stays trapped inside style="...".
    expect(out).not.toContain('<img src=x onerror=alert(1)>')
    expect(out).toContain('&quot;')
    expect(out).toContain('<mark style="background-color:')
  })

  it('mention renders as plain @displayName (no dead uid link)', async () => {
    const out = await md(
      doc(p({ type: 'mention', attrs: { id: 'u_42', label: 'Alice', type: 'user' } })),
    )
    expect(out).toContain('@Alice')
    expect(out).not.toContain('u_42')
    expect(out).not.toContain('](u_42)')
  })

  it('emoji uses the resolved glyph when available, else a shortcode', async () => {
    const glyph = (name: string | null | undefined) => (name === 'smile' ? '😄' : undefined)
    const out = await md(
      doc(p({ type: 'emoji', attrs: { name: 'smile' } }, { type: 'emoji', attrs: { name: 'unknownx' } })),
      { emojiGlyph: glyph },
    )
    expect(out).toContain('😄')
    expect(out).toContain(':unknownx:')
  })

  it('text alignment wraps the block in an aligned tag', async () => {
    const out = await md(doc({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('mid')] }))
    expect(out).toContain('<p align="center">mid</p>')
  })

  it('indent (v18) wraps the block with a margin-left style', async () => {
    const out = await md(doc({ type: 'paragraph', attrs: { indent: 2 }, content: [text('in')] }))
    expect(out).toContain('<p style="margin-left:4em">in</p>')
  })

  it('indent + align combine into one wrapper tag', async () => {
    const out = await md(
      doc({ type: 'paragraph', attrs: { textAlign: 'right', indent: 1 }, content: [text('both')] }),
    )
    expect(out).toContain('<p align="right" style="margin-left:2em">both</p>')
  })

  it('an indented heading wraps in a div with margin-left', async () => {
    const out = await md(doc({ type: 'heading', attrs: { level: 2, indent: 1 }, content: [text('h')] }))
    expect(out).toContain('<div style="margin-left:2em">## h</div>')
  })

  it('indent 0 leaves the block as plain Markdown (backward-compat)', async () => {
    const out = await md(doc({ type: 'paragraph', attrs: { indent: 0 }, content: [text('plain')] }))
    expect(out).not.toContain('margin-left')
    expect(out).toContain('plain')
  })
})

// Regression (yujiawei P1 #3): markdown export interpolated hrefs and HTML-attribute values with
// ZERO escaping, so a `javascript:` link or a `"`-bearing attribute survived into the export and
// became a stored-XSS sink when the .md was rendered. Hrefs are scheme-gated; attribute values
// are HTML-escaped.
describe('exportDocToMarkdown — XSS hardening of hrefs and attributes', () => {
  it('drops a javascript: link href, keeping the visible text', async () => {
    const out = await md(doc(p(text('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))))
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('(javascript')
    expect(out).toContain('click') // text is preserved, only the link sink is removed
  })

  it('drops a data: link href', async () => {
    const out = await md(
      doc(p(text('x', [{ type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } }]))),
    )
    expect(out).not.toContain('data:text/html')
    expect(out).not.toContain('<script>')
  })

  it('keeps a safe http(s) link unchanged (no trailing-slash normalization)', async () => {
    const out = await md(doc(p(text('l', [{ type: 'link', attrs: { href: 'https://x.io' } }]))))
    expect(out).toContain('[l](https://x.io)')
  })

  it('escapes parentheses in a link href so it cannot break out of the (...) destination', async () => {
    const out = await md(doc(p(text('l', [{ type: 'link', attrs: { href: 'https://x.io/a(b)c' } }]))))
    expect(out).toContain('[l](https://x.io/a%28b%29c)')
  })

  it('drops a javascript: bookmark url', async () => {
    const out = await md(
      doc({ type: 'bookmark', attrs: { url: 'javascript:alert(1)', title: 'evil' } }),
    )
    expect(out).not.toContain('javascript:')
    expect(out).toContain('[evil]()') // no link target emitted
  })

  it('escapes a quoted attribute-injection in the textStyle color (style="...")', async () => {
    const out = await md(
      doc(p(text('c', [{ type: 'textStyle', attrs: { color: 'red"><img src=x onerror=alert(1)>' } }]))),
    )
    expect(out).not.toContain('"><img')
    expect(out).not.toContain('<img src=x') // angle brackets + quote are entity-escaped
    expect(out).toContain('&quot;&gt;&lt;img')
  })

  it('escapes a quoted attribute-injection in textAlign (align="...")', async () => {
    const out = await md(
      doc({ type: 'paragraph', attrs: { textAlign: 'center"><script>alert(1)</script>' }, content: [text('m')] }),
    )
    expect(out).not.toContain('"><script>')
    expect(out).not.toContain('<script>')
  })

  it('escapes a quoted attribute-injection in a callout variant', async () => {
    const out = await md(
      doc({
        type: 'callout',
        attrs: { variant: 'info"><img src=x onerror=alert(1)>' },
        content: [p(text('hi'))],
      }),
    )
    expect(out).not.toContain('"><img')
    expect(out).not.toContain('<img src=x')
  })

  it('does not emit an executable image title even with embedded quotes', async () => {
    const out = await md(
      doc({ type: 'image', attrs: { attachId: 'img1', alt: 'a', title: 'cap" onerror="alert(1)' } }),
    )
    // The injected quote is backslash-escaped inside the markdown title, never closing it early.
    expect(out).not.toContain('cap" onerror=')
    expect(out).toContain('\\"')
  })
})
