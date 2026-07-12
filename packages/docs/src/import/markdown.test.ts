import { describe, it, expect } from 'vitest'
import { parseMarkdownToPmDoc, type PmNode } from './markdown.ts'
import { isSafeHref, isSafeCssColor } from './html-inline.ts'
import { stripFrontMatter } from './frontmatter.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(input: string) {
  return parseMarkdownToPmDoc(input)
}

function firstBlock(result: ReturnType<typeof parse>): PmNode {
  return result.doc.content![0]
}

function textContent(node: PmNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textContent).join('')
}

// ── Block nodes ───────────────────────────────────────────────────────────────

describe('parseMarkdownToPmDoc — block nodes', () => {
  it('parses headings with correct level', () => {
    const r = parse('# H1\n## H2\n### H3')
    expect(r.doc.content!.length).toBe(3)
    expect(r.doc.content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(r.doc.content![1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(r.doc.content![2]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
  })

  it('extracts title from first H1', () => {
    const r = parse('# My Title\nSome content')
    expect(r.title).toBe('My Title')
  })

  it('parses paragraphs', () => {
    const r = parse('Hello world')
    expect(firstBlock(r)).toMatchObject({ type: 'paragraph' })
    expect(textContent(firstBlock(r))).toBe('Hello world')
  })

  it('parses bullet lists', () => {
    const r = parse('- item A\n- item B')
    expect(firstBlock(r).type).toBe('bulletList')
    expect(firstBlock(r).content!.length).toBe(2)
    expect(firstBlock(r).content![0].type).toBe('listItem')
  })

  it('parses ordered lists', () => {
    const r = parse('1. first\n2. second')
    expect(firstBlock(r).type).toBe('orderedList')
  })

  it('parses task lists', () => {
    const r = parse('- [ ] todo\n- [x] done')
    expect(firstBlock(r).type).toBe('taskList')
    expect(firstBlock(r).content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: false } })
    expect(firstBlock(r).content![1]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('maps a checkmark glyph in the checkbox to a checked task item', () => {
    // Someone may hand-write `[✓]` / `[√]` instead of `[x]`; treat as checked.
    const r = parse('- [✓] a\n- [√] b\n- [ ] c')
    expect(firstBlock(r).type).toBe('taskList')
    expect(firstBlock(r).content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
    expect(firstBlock(r).content![1]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
    expect(firstBlock(r).content![2]).toMatchObject({ type: 'taskItem', attrs: { checked: false } })
  })

  it('does NOT treat a normal bullet starting with a check emoji as a task', () => {
    // A bare leading ✅ (no brackets) is ordinary list content, not a checkbox.
    const r = parse('- ✅ 这是普通列表项\n- ⚠／ 警告项')
    expect(firstBlock(r).type).toBe('bulletList')
  })

  it('parses blockquotes', () => {
    const r = parse('> quoted text')
    expect(firstBlock(r).type).toBe('blockquote')
  })

  it('parses fenced code blocks with language', () => {
    const r = parse('```ts\nconst x = 1\n```')
    const cb = firstBlock(r)
    expect(cb.type).toBe('codeBlock')
    expect(cb.attrs?.language).toBe('ts')
    expect(textContent(cb)).toBe('const x = 1')
  })

  it('parses horizontal rules', () => {
    const r = parse('---')
    expect(firstBlock(r).type).toBe('horizontalRule')
  })

  it('parses GFM tables', () => {
    const r = parse('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const table = firstBlock(r)
    expect(table.type).toBe('table')
    expect(table.content!.length).toBe(2) // header + body row
    expect(table.content![0].content![0].type).toBe('tableHeader')
  })

  it('produces empty paragraph for empty input', () => {
    const r = parse('')
    expect(r.doc.content!.length).toBe(1)
    expect(r.doc.content![0].type).toBe('paragraph')
  })

  it('parses a standalone $$...$$ paragraph as blockMath (export inverse)', () => {
    const r = parse('$$\nE=mc^2\n$$')
    const b = firstBlock(r)
    expect(b.type).toBe('blockMath')
    expect(b.attrs?.latex).toBe('E=mc^2')
  })

  it('preserves multi-line LaTeX in block math', () => {
    const r = parse('$$\n\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}\n$$')
    const b = firstBlock(r)
    expect(b.type).toBe('blockMath')
    expect(b.attrs?.latex).toBe('\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}')
  })

  it('block math surrounded by paragraphs keeps order', () => {
    const r = parse('before\n\n$$\na+b\n$$\n\nafter')
    expect(r.doc.content!.map(n => n.type)).toEqual(['paragraph', 'blockMath', 'paragraph'])
  })

  it('does not treat inline $..$ text as block math', () => {
    const r = parse('cost is $5 and $10 total')
    const b = firstBlock(r)
    expect(b.type).toBe('paragraph')
  })

  it('preserves a non-default ordered list start index', () => {
    const r = parse('5. five\n6. six\n7. seven')
    const list = firstBlock(r)
    expect(list.type).toBe('orderedList')
    expect(list.attrs?.start).toBe(5)
    expect(list.content!.length).toBe(3)
  })

  it('omits start when an ordered list begins at 1', () => {
    const r = parse('1. one\n2. two')
    const list = firstBlock(r)
    expect(list.type).toBe('orderedList')
    expect(list.attrs?.start).toBeUndefined()
  })
})

// ── Inline / marks ────────────────────────────────────────────────────────────

describe('parseMarkdownToPmDoc — inline marks', () => {
  it('parses bold', () => {
    const r = parse('**bold**')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'bold' })
  })

  it('parses italic', () => {
    const r = parse('*italic*')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'italic' })
  })

  it('parses inline code', () => {
    const r = parse('`code`')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'code' })
  })

  it('parses strikethrough', () => {
    const r = parse('~~struck~~')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'strike' })
  })

  it('parses ==highlight== as highlight mark', () => {
    const r = parse('a ==marked== b')
    const p = firstBlock(r)
    const hl = p.content!.find(n => n.marks?.some(m => m.type === 'highlight'))
    expect(hl).toBeDefined()
    expect(hl!.text).toBe('marked')
  })

  it('parses <mark style="background-color:..."> into a colored highlight', () => {
    const r = parse('<mark style="background-color:#fff3a3">yellow</mark>')
    const p = firstBlock(r)
    const hl = p.content!.find(n => n.marks?.some(m => m.type === 'highlight'))
    expect(hl).toBeDefined()
    expect(hl!.marks).toContainEqual({ type: 'highlight', attrs: { color: '#fff3a3' } })
  })

  it('parses links with safe href', () => {
    const r = parse('[click](https://example.com)')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'link', attrs: { href: 'https://example.com/' } })
  })

  it('drops unsafe link hrefs', () => {
    const r = parse('[evil](javascript:alert(1))')
    const p = firstBlock(r)
    // Link mark should NOT be present
    expect(p.content![0].marks ?? []).not.toContainEqual(expect.objectContaining({ type: 'link' }))
  })

  it('parses inline math $...$', () => {
    const r = parse('Formula $E=mc^2$ here')
    const p = firstBlock(r)
    const mathNode = p.content!.find(n => n.type === 'inlineMath')
    expect(mathNode).toBeDefined()
    expect(mathNode!.attrs?.latex).toBe('E=mc^2')
  })

  it('does not treat currency dollar amounts as inline math', () => {
    const r = parse('这件 $5 那件 $9 都不贵')
    const p = firstBlock(r)
    expect(p.content!.some(n => n.type === 'inlineMath')).toBe(false)
    expect(textContent(p)).toBe('这件 $5 那件 $9 都不贵')
  })

  it('keeps currency but still parses a real formula on the same line', () => {
    const r = parse('价格 $5 但公式 $x^2$ 对')
    const p = firstBlock(r)
    const math = p.content!.filter(n => n.type === 'inlineMath')
    expect(math.length).toBe(1)
    expect(math[0].attrs?.latex).toBe('x^2')
    expect(textContent(p)).toContain('$5')
  })

  it('parses emoji shortcodes when the resolver confirms them', () => {
    const r = parseMarkdownToPmDoc('Hello :smile: world', { emojiName: (n) => (n === 'smile' ? '😄' : undefined) })
    const p = firstBlock(r)
    const emojiNode = p.content!.find(n => n.type === 'emoji')
    expect(emojiNode).toBeDefined()
    expect(emojiNode!.attrs?.name).toBe('smile')
  })

  it('keeps unknown emoji shortcodes as literal text', () => {
    const r = parseMarkdownToPmDoc('a :not_a_real_emoji: b', { emojiName: () => undefined })
    const p = firstBlock(r)
    expect(p.content!.find(n => n.type === 'emoji')).toBeUndefined()
    expect(textContent(p)).toBe('a :not_a_real_emoji: b')
  })

  it('does not emit emoji nodes without a resolver', () => {
    const r = parse('Hello :smile: world')
    const p = firstBlock(r)
    expect(p.content!.find(n => n.type === 'emoji')).toBeUndefined()
    expect(textContent(p)).toContain(':smile:')
  })
})

// ── Images ────────────────────────────────────────────────────────────────────

describe('parseMarkdownToPmDoc — images', () => {
  it('imports network images', () => {
    const r = parse('![alt](https://example.com/img.png)')
    const p = firstBlock(r)
    const img = p.content!.find(n => n.type === 'image')
    expect(img).toBeDefined()
    expect(img!.attrs?.src).toBe('https://example.com/img.png')
    expect(img!.attrs?.alt).toBe('alt')
  })

  it('degrades local images to text placeholder', () => {
    const r = parse('![logo](./logo.png)')
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0]).toContain('本地图片')
    const p = firstBlock(r)
    // Should be text, not image
    expect(p.content!.find(n => n.type === 'image')).toBeUndefined()
  })

  it('degrades data: images to text placeholder', () => {
    const r = parse('![x](data:image/png;base64,abc)')
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

// ── Security ──────────────────────────────────────────────────────────────────

describe('isSafeHref', () => {
  it('accepts http/https/mailto/tel', () => {
    expect(isSafeHref('https://example.com')).toBeTruthy()
    expect(isSafeHref('http://example.com')).toBeTruthy()
    expect(isSafeHref('mailto:a@b.com')).toBeTruthy()
    expect(isSafeHref('tel:+1234567890')).toBeTruthy()
  })

  it('rejects javascript:/data:/vbscript:', () => {
    expect(isSafeHref('javascript:alert(1)')).toBeNull()
    expect(isSafeHref('data:text/html,<h1>hi</h1>')).toBeNull()
    expect(isSafeHref('vbscript:msgbox')).toBeNull()
  })

  it('rejects tab-bypass variants', () => {
    expect(isSafeHref('java\tscript:alert(1)')).toBeNull()
  })

  it('accepts relative URLs', () => {
    expect(isSafeHref('/path/to/page')).toBeTruthy()
    expect(isSafeHref('page.html')).toBeTruthy()
  })
})

describe('isSafeCssColor', () => {
  it('accepts hex colors', () => {
    expect(isSafeCssColor('#ff0000')).toBe('#ff0000')
    expect(isSafeCssColor('#f00')).toBe('#f00')
  })

  it('accepts rgb/rgba/hsl', () => {
    expect(isSafeCssColor('rgb(255, 0, 0)')).toBeTruthy()
    expect(isSafeCssColor('rgba(255, 0, 0, 0.5)')).toBeTruthy()
    expect(isSafeCssColor('hsl(120, 100%, 50%)')).toBeTruthy()
  })

  it('accepts named colors', () => {
    expect(isSafeCssColor('red')).toBe('red')
    expect(isSafeCssColor('blue')).toBe('blue')
  })

  it('rejects CSS injection attempts', () => {
    expect(isSafeCssColor('red;position:fixed')).toBeNull()
    expect(isSafeCssColor('red;background:url(evil)')).toBeNull()
  })
})

// ── Front matter ──────────────────────────────────────────────────────────────

describe('stripFrontMatter', () => {
  it('extracts title from YAML front matter', () => {
    const r = stripFrontMatter('---\ntitle: My Doc\nauthor: test\n---\nBody')
    expect(r.frontMatter.title).toBe('My Doc')
    expect(r.body).toBe('Body')
  })

  it('returns input unchanged when no front matter', () => {
    const r = stripFrontMatter('Just text')
    expect(r.frontMatter.title).toBeUndefined()
    expect(r.body).toBe('Just text')
  })

  it('uses front matter title as doc title', () => {
    const r = parse('---\ntitle: FM Title\n---\n# H1 Title\nBody')
    expect(r.title).toBe('FM Title')
  })
})

// ── HTML blocks (whitelist) ───────────────────────────────────────────────────

describe('parseMarkdownToPmDoc — HTML blocks', () => {
  it('drops HTML comments instead of emitting them as text', () => {
    const r = parse('<!-- 注意：签名链接可能过期 -->\n\n# 标题\n\n正文')
    expect(r.doc.content!.map(n => n.type)).toEqual(['heading', 'paragraph'])
  })

  it('drops a leading export-header comment (no stray text block)', () => {
    const r = parse('<!-- 注意：图片/附件为签名链接，可能过期 -->\n\n正文段落')
    expect(r.doc.content!.length).toBe(1)
    expect(firstBlock(r).type).toBe('paragraph')
    expect(textContent(firstBlock(r))).toBe('正文段落')
  })

  it('parses callout divs', () => {
    const r = parse('<div data-callout data-variant="warning">\n\nWatch out!\n\n</div>')
    const callout = firstBlock(r)
    expect(callout.type).toBe('callout')
    expect(callout.attrs?.variant).toBe('warning')
  })

  it('re-parses callout body as block content (headings, lists survive)', () => {
    const r = parse('<div data-callout data-variant="info">\n\n# Title\n\nbody para\n\n- one\n- two\n\n</div>')
    const callout = firstBlock(r)
    expect(callout.type).toBe('callout')
    const kinds = callout.content!.map(n => n.type)
    expect(kinds).toEqual(['heading', 'paragraph', 'bulletList'])
    expect(callout.content![0].attrs?.level).toBe(1)
  })

  it('parses details/summary', () => {
    const r = parse('<details>\n<summary>Click me</summary>\n\nHidden content\n\n</details>')
    const details = firstBlock(r)
    expect(details.type).toBe('details')
    expect(details.content!.length).toBe(2)
    expect(details.content![0].type).toBe('detailsSummary')
    expect(details.content![1].type).toBe('detailsContent')
  })

  it('re-parses details body as block content', () => {
    const r = parse('<details>\n<summary>More</summary>\n\n## Sub\n\n- a\n- b\n\n</details>')
    const details = firstBlock(r)
    const body = details.content!.find(n => n.type === 'detailsContent')!
    expect(body.content!.map(n => n.type)).toEqual(['heading', 'bulletList'])
  })

  it('parses HTML tables with colspan/rowspan', () => {
    const html = '<table>\n<tr><th colspan="2">Header</th></tr>\n<tr><td>A</td><td>B</td></tr>\n</table>'
    const r = parse(html)
    const table = firstBlock(r)
    expect(table.type).toBe('table')
    expect(table.content![0].content![0].attrs?.colspan).toBe(2)
  })
})

// ── Inline HTML marks ─────────────────────────────────────────────────────────

describe('parseMarkdownToPmDoc — inline HTML marks', () => {
  it('parses <u> as underline', () => {
    const r = parse('<u>underlined</u>')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'underline' })
  })

  it('parses <mark> as highlight', () => {
    const r = parse('<mark>highlighted</mark>')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'highlight' })
  })

  it('parses <sub>/<sup>', () => {
    const r = parse('H<sub>2</sub>O and x<sup>2</sup>')
    const p = firstBlock(r)
    expect(p.content!.some(n => n.marks?.some(m => m.type === 'subscript'))).toBe(true)
    expect(p.content!.some(n => n.marks?.some(m => m.type === 'superscript'))).toBe(true)
  })

  it('parses <span style="color:..."> as textStyle', () => {
    const r = parse('<span style="color:red">colored</span>')
    const p = firstBlock(r)
    expect(p.content![0].marks).toContainEqual({ type: 'textStyle', attrs: { color: 'red' } })
  })

  it('drops unsafe CSS color values', () => {
    const r = parse('<span style="color:red;position:fixed">evil</span>')
    const p = firstBlock(r)
    // textStyle mark should NOT be applied with the injected value
    const ts = p.content![0].marks?.find(m => m.type === 'textStyle')
    expect(ts).toBeUndefined()
  })
})
