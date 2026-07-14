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
})
