import { describe, it, expect } from 'vitest'
import { parseMarkdownToPmDoc } from './markdown.ts'

function mathAndText(md: string): { math: string[]; text: string[] } {
  const res = parseMarkdownToPmDoc(md) as { doc?: unknown }
  const doc = res.doc ?? res
  const math: string[] = []
  const text: string[] = []
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; attrs?: { latex?: string }; content?: unknown[]; text?: string }
    if (node.type === 'inlineMath' || node.type === 'blockMath') math.push(node.attrs?.latex ?? '')
    if (node.type === 'text' && node.text) text.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc)
  return { math, text }
}

describe('markdown import — dollar math', () => {
  it('detects a formula that starts with a digit', () => {
    expect(mathAndText('公式 $2^{2^{2}}$ 结束').math).toEqual(['2^{2^{2}}'])
  })

  it('preserves LaTeX row breaks (\\\\) inside inline math', () => {
    const { math } = mathAndText('$\\begin{matrix} a \\\\ b \\end{matrix}$')
    expect(math[0]).toContain('\\\\')
    expect(math[0]).toBe('\\begin{matrix} a \\\\ b \\end{matrix}')
  })

  it('maps $$…$$ to blockMath, preserving escapes', () => {
    const { math } = mathAndText('$$\\frac{a}{b} \\\\ c$$')
    expect(math).toEqual(['\\frac{a}{b} \\\\ c'])
  })

  it('does NOT swallow currency like $5 and $9', () => {
    const { math, text } = mathAndText('价格 $5 到 $9 之间')
    expect(math).toEqual([])
    expect(text.join('')).toContain('$5')
    expect(text.join('')).toContain('$9')
  })

  it('does not treat a lone $ as math', () => {
    const { math } = mathAndText('cost is $ today')
    expect(math).toEqual([])
  })

  it('lifts an inline $$…$$ out of the paragraph so it is a schema-valid block node', () => {
    // Regression: a `$$…$$` mixed with surrounding text (or inside a list/quote/cell) used to be
    // emitted as a blockMath nested INSIDE a paragraph's inline content — schema-invalid, so
    // setContent silently dropped it. blocksFromInline must lift blockMath to a top-level block.
    const res = parseMarkdownToPmDoc('foo $$E=mc^2$$ bar') as { doc?: { content?: unknown[] } }
    const doc = (res.doc ?? res) as { content?: Array<{ type?: string; content?: Array<{ type?: string }> }> }
    const top = doc.content ?? []
    // blockMath appears as a direct top-level block, NOT nested inside a paragraph.
    const topBlockMath = top.filter((n) => n.type === 'blockMath')
    expect(topBlockMath).toHaveLength(1)
    const nestedInParagraph = top.some(
      (n) => n.type === 'paragraph' && (n.content ?? []).some((c) => c.type === 'blockMath'),
    )
    expect(nestedInParagraph).toBe(false)
    // The surrounding text survives as its own paragraph(s).
    expect(mathAndText('foo $$E=mc^2$$ bar').text.join('')).toContain('foo')
  })

  it('lifts a $$…$$ block out of a list item paragraph', () => {
    const res = parseMarkdownToPmDoc('- item with $$x^2$$ here') as { doc?: unknown }
    const doc = res.doc ?? res
    let nestedInParagraph = 0
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      const node = n as { type?: string; content?: unknown[] }
      if (node.type === 'paragraph' && Array.isArray(node.content)) {
        for (const c of node.content) if ((c as { type?: string }).type === 'blockMath') nestedInParagraph++
      }
      if (Array.isArray(node.content)) node.content.forEach(walk)
    }
    walk(doc)
    expect(nestedInParagraph).toBe(0)
    expect(mathAndText('- item with $$x^2$$ here').math).toContain('x^2')
  })
})
