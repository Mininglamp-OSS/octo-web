/**
 * Tests for ordered-list numbering in DOCX export.
 *
 * Verifies:
 *  - Two independent ordered lists each restart at 1 (not continuous counting).
 *  - A list with explicit start > 1 begins at that value.
 *  - Nested ordered lists restart independently at the correct level.
 */
import { describe, it, expect } from 'vitest'
import { Packer, Document } from 'docx'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertBlocks, NUMBERING_CONFIG } from './nodes.ts'
import { DOCX_STYLES } from './styles.ts'
import type { MdNode, DocxContext } from './types.ts'

function ol(items: string[], start?: number): MdNode {
  return {
    type: 'orderedList',
    ...(start ? { attrs: { start } } : {}),
    content: items.map((t) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  } as MdNode
}

function para(text: string): MdNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] } as MdNode
}

async function buildNumberingXml(content: MdNode[]) {
  const ctx: DocxContext = { urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0 }
  const children = convertBlocks(content, ctx)
  const orderedLevels = NUMBERING_CONFIG.config[1].levels
  const numbering = {
    config: [
      ...NUMBERING_CONFIG.config,
      ...ctx.dynamicNumbering.map((dn) => ({
        reference: dn.reference,
        levels: orderedLevels.map((lvl) => (lvl.level === dn.level ? { ...lvl, start: dn.start } : lvl)),
      })),
    ],
  }
  const doc = new Document({ styles: DOCX_STYLES, numbering, sections: [{ children }] })
  const buf = await Packer.toBuffer(doc)
  const path = join(tmpdir(), `numbering-test-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
  writeFileSync(path, buf)
  const numXml = execSync(`unzip -p ${path} word/numbering.xml`).toString()
  const docXml = execSync(`unzip -p ${path} word/document.xml`).toString()
  return { numXml, docXml, ctx }
}

/** For each numbered paragraph, resolve its numId → abstractNum → level[0] start value. */
function resolveParagraphStarts(numXml: string, docXml: string): number[] {
  // Map numId → abstractNumId
  const numToAbstract = new Map<string, string>()
  for (const m of numXml.matchAll(/<w:num w:numId="(\d+)">\s*<w:abstractNumId w:val="(\d+)"/g)) {
    numToAbstract.set(m[1], m[2])
  }
  // Map abstractNumId → level0 start
  const abstractLvl0Start = new Map<string, number>()
  for (const m of numXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[\s\S]*?<w:lvl w:ilvl="0"[\s\S]*?<w:start w:val="(\d+)"/g)) {
    abstractLvl0Start.set(m[1], Number(m[2]))
  }
  // Collect numId per numbered top-level paragraph (ilvl 0)
  const starts: number[] = []
  for (const m of docXml.matchAll(/<w:numPr>\s*<w:ilvl w:val="0"\/>\s*<w:numId w:val="(\d+)"/g)) {
    const abs = numToAbstract.get(m[1])
    if (abs) starts.push(abstractLvl0Start.get(abs) ?? 1)
  }
  return starts
}

describe('ordered list numbering', () => {
  it('two independent lists each restart at 1 with distinct numbering instances', async () => {
    const { numXml, docXml, ctx } = await buildNumberingXml([
      ol(['a', 'b', 'c']),
      para('gap'),
      ol(['x', 'y']),
    ])
    // Each ordered list gets its own numbering instance (independent counting).
    expect(ctx.orderedListInstance).toBe(2)
    // The two lists reference distinct numIds so Word counts them separately.
    const numIds = [...docXml.matchAll(/<w:numPr>\s*<w:ilvl w:val="0"\/>\s*<w:numId w:val="(\d+)"/g)].map((m) => m[1])
    const list1 = numIds.slice(0, 3)
    const list2 = numIds.slice(3, 5)
    expect(new Set(list1).size).toBe(1) // list 1 items share one instance
    expect(new Set(list2).size).toBe(1) // list 2 items share one instance
    expect(list1[0]).not.toBe(list2[0]) // but the two lists differ
    // Both start at 1.
    expect(resolveParagraphStarts(numXml, docXml)).toEqual([1, 1, 1, 1, 1])
  })

  it('explicit start > 1 begins at that value', async () => {
    const { numXml, docXml } = await buildNumberingXml([ol(['p', 'q'], 5)])
    expect(resolveParagraphStarts(numXml, docXml)).toEqual([5, 5])
  })

  it('mixed: default list, then start=5 list — 1 and 5', async () => {
    const { numXml, docXml } = await buildNumberingXml([
      ol(['a', 'b', 'c']),
      para('gap'),
      ol(['p', 'q'], 5),
    ])
    expect(resolveParagraphStarts(numXml, docXml)).toEqual([1, 1, 1, 5, 5])
  })

  it('ordered list of display formulas keeps its numbering and the formulas', async () => {
    // path treated the first block as inline runs, silently dropping both the
    // formula and the list number — a numbered equation list lost all its
    // "1. 2. 3." markers. Assert every item now emits a w:numPr AND the OMML.
    const mathList: MdNode = {
      type: 'orderedList',
      content: ['a^2 + b^2 = c^2', 'E = mc^2', '\\int_0^1 x\\,dx'].map((latex) => ({
        type: 'listItem',
        content: [{ type: 'blockMath', attrs: { latex } }],
      })),
    } as MdNode
    const { docXml } = await buildNumberingXml([mathList])
    // Three numbered items at ilvl 0, all sharing one numbering instance.
    const numIds = [...docXml.matchAll(/<w:numPr>\s*<w:ilvl w:val="0"\/>\s*<w:numId w:val="(\d+)"/g)].map(
      (m) => m[1],
    )
    expect(numIds).toHaveLength(3)
    expect(new Set(numIds).size).toBe(1)
    // Each numbered paragraph carries a native OMML formula (not dropped).
    expect((docXml.match(/<m:oMath\b/g) ?? []).length).toBe(3)
  })

  it('nested ordered list with start=3 begins at 3', async () => {
    // bulletList > (item: para + orderedList(start=3))
    const doc: MdNode = {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [para('outer'), ol(['x', 'y'], 3)],
        },
      ],
    } as MdNode
    const { numXml } = await buildNumberingXml([doc])
    // The nested start=3 list gets a dynamic reference whose level 1 starts at 3.
    const dyn = [...numXml.matchAll(/<w:abstractNum[\s\S]*?<w:lvl w:ilvl="1"[\s\S]*?<w:start w:val="3"/g)]
    expect(dyn.length).toBeGreaterThanOrEqual(1)
  })
})
