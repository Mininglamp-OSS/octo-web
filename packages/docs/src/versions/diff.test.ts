import { describe, it, expect } from 'vitest'
import { docToBlocks, docToBlockLocations, diffBlocks, diffDocs, type PMNode } from './diff.ts'

function doc(...blocks: PMNode[]): PMNode {
  return { type: 'doc', content: blocks }
}
function para(text: string): PMNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

describe('docToBlocks — PM doc -> block text lines', () => {
  it('flattens paragraphs and headings to text lines', () => {
    const d = doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }, para('Hello world'))
    expect(docToBlocks(d)).toEqual(['Title', 'Hello world'])
  })

  it('recurses into containers (lists) so inner blocks each yield a line', () => {
    const list: PMNode = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para('one')] },
        { type: 'listItem', content: [para('two')] },
      ],
    }
    expect(docToBlocks(doc(list))).toEqual(['one', 'two'])
  })

  it('emits markers for atoms (image, horizontal rule)', () => {
    const d = doc({ type: 'image', attrs: { alt: 'a cat' } }, { type: 'horizontalRule' })
    expect(docToBlocks(d)).toEqual(['[image: a cat]', '———'])
  })

  it('returns [] for an empty doc', () => {
    expect(docToBlocks(doc())).toEqual([])
    expect(docToBlocks(null)).toEqual([])
  })
})

describe('diffBlocks — block-level LCS diff', () => {
  it('marks all unchanged for identical inputs', () => {
    const a = ['x', 'y', 'z']
    const out = diffBlocks(a, a.slice())
    expect(out.every((d) => d.type === 'unchanged')).toBe(true)
    expect(out.map((d) => d.text)).toEqual(['x', 'y', 'z'])
  })

  it('detects a pure addition', () => {
    const out = diffBlocks(['a', 'b'], ['a', 'b', 'c'])
    expect(out).toEqual([
      { type: 'unchanged', text: 'a' },
      { type: 'unchanged', text: 'b' },
      { type: 'added', text: 'c' },
    ])
  })

  it('detects a pure removal', () => {
    const out = diffBlocks(['a', 'b', 'c'], ['a', 'c'])
    expect(out).toEqual([
      { type: 'unchanged', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'unchanged', text: 'c' },
    ])
  })

  it('pairs an adjacent remove+add into a changed row', () => {
    const out = diffBlocks(['a', 'old', 'c'], ['a', 'new', 'c'])
    expect(out).toEqual([
      { type: 'unchanged', text: 'a' },
      { type: 'changed', before: 'old', after: 'new' },
      { type: 'unchanged', text: 'c' },
    ])
  })

  it('handles surplus removals/additions around a changed pair', () => {
    const out = diffBlocks(['r1', 'r2'], ['a1'])
    expect(out).toEqual([
      { type: 'changed', before: 'r1', after: 'a1' },
      { type: 'removed', text: 'r2' },
    ])
  })

  it('two empty docs diff to nothing', () => {
    expect(diffBlocks([], [])).toEqual([])
  })

  it('everything added when before is empty', () => {
    expect(diffBlocks([], ['a', 'b'])).toEqual([
      { type: 'added', text: 'a' },
      { type: 'added', text: 'b' },
    ])
  })
})

describe('diffDocs — end to end over PM docs', () => {
  it('diffs two documents at block level', () => {
    const before = doc(para('intro'), para('middle'), para('end'))
    const after = doc(para('intro'), para('changed middle'), para('end'))
    expect(diffDocs(before, after)).toEqual([
      { type: 'unchanged', text: 'intro' },
      { type: 'changed', before: 'middle', after: 'changed middle' },
      { type: 'unchanged', text: 'end' },
    ])
  })

  it('returns a single too-large sentinel when the LCS table would blow up', () => {
    const big = Array.from({ length: 1200 }, (_, i) => `line ${i}`)
    const other = Array.from({ length: 1200 }, (_, i) => `other ${i}`)
    // 1200 * 1200 = 1.44M cells > MAX_DIFF_CELLS (1M) -> capped.
    const result = diffBlocks(big, other)
    expect(result).toEqual([{ type: 'too-large' }])
  })

  it('does NOT cap a normal-sized doc', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const result = diffBlocks(a, b)
    expect(result.every((d) => d.type === 'unchanged')).toBe(true)
    expect(result).toHaveLength(50)
  })
})

describe('docToBlockLocations', () => {
  // hunk 头的定位。原型写「@@ 一、当前问题 · 第 3 段 @@」而不是「第 1 处」——「第几处」只说明
  // 这是本次的第几个改动,读者真正要问的是「改到文档哪儿了」。
  const doc: PMNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '前言' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '一、当前问题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'p1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'p2' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '二、方案原则' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'p3' }] },
    ],
  }

  it('lines up 1:1 with docToBlocks', () => {
    // 两者靠同一套遍历规则走,长度必须相等 —— 错位会让 hunk 头指到别的段上,那比不显示更糟。
    expect(docToBlockLocations(doc)).toHaveLength(docToBlocks(doc).length)
  })

  it('has no section before the first heading', () => {
    expect(docToBlockLocations(doc)[0]).toEqual({ sectionTitle: null, ordinalInSection: 1 })
  })

  it('reports the heading itself as ordinal 0 of its own section', () => {
    // 命中标题行的 hunk 该报这个标题,而不是上一节的尾巴。
    expect(docToBlockLocations(doc)[1]).toEqual({ sectionTitle: '一、当前问题', ordinalInSection: 0 })
  })

  it('numbers paragraphs within their section', () => {
    const locs = docToBlockLocations(doc)
    expect(locs[2]).toEqual({ sectionTitle: '一、当前问题', ordinalInSection: 1 })
    expect(locs[3]).toEqual({ sectionTitle: '一、当前问题', ordinalInSection: 2 })
  })

  it('restarts numbering at the next heading', () => {
    const locs = docToBlockLocations(doc)
    expect(locs[5]).toEqual({ sectionTitle: '二、方案原则', ordinalInSection: 1 })
  })

  it('counts images and rules as blocks too (they are diff lines)', () => {
    // docToBlocks 会为它们各产生一行,这里漏掉就会整体错位。
    const withMedia: PMNode = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'H' }] },
        { type: 'image', attrs: { alt: 'a' } },
        { type: 'horizontalRule' },
      ],
    }
    expect(docToBlockLocations(withMedia)).toHaveLength(docToBlocks(withMedia).length)
    expect(docToBlockLocations(withMedia)[1]?.ordinalInSection).toBe(1)
    expect(docToBlockLocations(withMedia)[2]?.ordinalInSection).toBe(2)
  })

  it('recurses into containers like docToBlocks does', () => {
    const nested: PMNode = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'H' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'li' }] }] }],
        },
      ],
    }
    expect(docToBlockLocations(nested)).toHaveLength(docToBlocks(nested).length)
    expect(docToBlockLocations(nested)[1]).toEqual({ sectionTitle: 'H', ordinalInSection: 1 })
  })
})
