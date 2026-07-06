/**
 * Fallback behavior for math in the DOCX export.
 *
 * When LaTeX → OMML conversion fails (bad init, unsupported construct, etc.),
 * `latexToMathComponent` returns null and the node/mark converters must fall
 * back to rendering the raw LaTeX source as text rather than crashing the
 * export or silently dropping the formula. We force the failure by mocking the
 * math module so it always returns null.
 */
import { describe, it, expect, vi } from 'vitest'

// Force every conversion to "fail" so the fallback branches run.
vi.mock('./math.ts', () => ({
  latexToMathComponent: () => null,
}))

import { convertBlocks } from './nodes.ts'
import type { MdNode, DocxContext } from './types.ts'

function newCtx(): DocxContext {
  return { urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0 }
}

/** Collect all text found in a docx element tree via JSON round-trip. */
function serialize(el: unknown): string {
  return JSON.stringify(el)
}

describe('math fallback when conversion fails', () => {
  it('block math falls back to the raw LaTeX source text', () => {
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\int_0^1 x\\,dx' } },
    ] as MdNode[]

    const children = convertBlocks(doc, newCtx())
    expect(children.length).toBe(1)
    const json = serialize(children[0])
    // Source text preserved, no OMML emitted.
    expect(json).toContain('\\\\int_0^1 x')
    expect(json).not.toContain('m:oMath')
  })

  it('inline math falls back to $...$ wrapped source text', () => {
    const doc: MdNode[] = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a ' },
          { type: 'inlineMath', attrs: { latex: 'x^2' } },
          { type: 'text', text: ' b' },
        ],
      },
    ] as MdNode[]

    const children = convertBlocks(doc, newCtx())
    const json = serialize(children[0])
    expect(json).toContain('$x^2$')
    expect(json).not.toContain('m:oMath')
    // Surrounding text still present.
    expect(json).toContain('a ')
    expect(json).toContain(' b')
  })

  it('does not throw — export stays alive on conversion failure', () => {
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
    ] as MdNode[]
    expect(() => convertBlocks(doc, newCtx())).not.toThrow()
  })
})
