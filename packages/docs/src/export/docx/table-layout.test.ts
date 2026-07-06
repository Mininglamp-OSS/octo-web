/**
 * Tests for DOCX table export layout:
 *  1. Column widths — columns are distributed evenly when the doc has no
 *     explicit colwidth (Word's auto layout otherwise squeezes empty columns),
 *     and explicit colwidth values are honored when present.
 *  2. Repeating header row across page breaks (w:tblHeader).
 */
import { describe, it, expect } from 'vitest'
import { Packer, Document } from 'docx'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertTable } from './tables.ts'
import type { MdNode, DocxContext } from './types.ts'

function makeCtx(): DocxContext {
  return { urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0 } as DocxContext
}

async function exportXml(table: MdNode) {
  const document = new Document({ sections: [{ children: [convertTable(table, makeCtx())] }] })
  const buf = await Packer.toBuffer(document)
  const path = join(tmpdir(), `tbl-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
  writeFileSync(path, buf)
  return execSync(`unzip -p ${path} word/document.xml`).toString()
}

function cell(text: string, attrs?: Record<string, unknown>, header = false): MdNode {
  return {
    type: header ? 'tableHeader' : 'tableCell',
    attrs,
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  } as MdNode
}

describe('DOCX table layout', () => {
  it('distributes columns evenly when there is no explicit colwidth', async () => {
    const table: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('列A', undefined, true), cell('列B', undefined, true), cell('列C', undefined, true)] },
        { type: 'tableRow', content: [cell('很多很多内容占满一整行'), cell(''), cell('')] },
      ],
    } as MdNode
    const xml = await exportXml(table)
    const gridCols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
    expect(gridCols.length).toBe(3)
    // Even distribution: all three widths equal (fallbackEven), not content-based.
    expect(new Set(gridCols).size).toBe(1)
    expect(gridCols[0]).toBeGreaterThan(1000)
  })

  it('honors explicit colwidth values (wide vs narrow)', async () => {
    const table: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('宽', { colwidth: [300] }, true), cell('窄', { colwidth: [100] }, true)] },
        { type: 'tableRow', content: [cell('a', { colwidth: [300] }), cell('b', { colwidth: [100] })] },
      ],
    } as MdNode
    const xml = await exportXml(table)
    const gridCols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
    expect(gridCols.length).toBe(2)
    // 300px*15 = 4500, 100px*15 = 1500
    expect(gridCols[0]).toBe(4500)
    expect(gridCols[1]).toBe(1500)
    expect(gridCols[0]).toBeGreaterThan(gridCols[1])
  })

  it('marks the first header row to repeat on every page (w:tblHeader)', async () => {
    const table: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('H1', undefined, true), cell('H2', undefined, true)] },
        { type: 'tableRow', content: [cell('a'), cell('b')] },
        { type: 'tableRow', content: [cell('c'), cell('d')] },
      ],
    } as MdNode
    const xml = await exportXml(table)
    const headerCount = (xml.match(/<w:tblHeader/g) || []).length
    // Exactly one row flagged as the repeating header.
    expect(headerCount).toBe(1)
  })

  it('does not flag a header when the first row has no tableHeader cells', async () => {
    const table: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('a'), cell('b')] },
        { type: 'tableRow', content: [cell('c'), cell('d')] },
      ],
    } as MdNode
    const xml = await exportXml(table)
    expect((xml.match(/<w:tblHeader/g) || []).length).toBe(0)
  })

  it('uses fixed table layout so columns stay predictable', async () => {
    const table: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }],
    } as MdNode
    const xml = await exportXml(table)
    expect(xml).toContain('w:type="fixed"')
  })

  it('maps column widths correctly when a cell spans multiple columns', async () => {
    // Grid columns: [c0=200px, c1=100px, c2=100px]. First data row has a cell
    // that spans c0+c1, then a normal cell for c2. The spanning cell must get
    // the SUM of its covered columns' widths, and the following cell must not
    // be shifted off by one.
    const table: MdNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            cell('A', { colwidth: [200] }, true),
            cell('B', { colwidth: [100] }, true),
            cell('C', { colwidth: [100] }, true),
          ],
        },
        {
          type: 'tableRow',
          content: [cell('span2', { colspan: 2 }), cell('c')],
        },
      ],
    } as MdNode
    const xml = await exportXml(table)
    // Grid definition: 200*15=3000, 100*15=1500, 100*15=1500
    const gridCols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
    expect(gridCols).toEqual([3000, 1500, 1500])
    // The spanning cell's own width (w:tcW) should be the sum of c0+c1 = 4500.
    const tcW = [...xml.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"/g)].map((m) => Number(m[1]))
    expect(tcW).toContain(4500)
    // The spanning cell must also carry gridSpan=2.
    expect(xml).toContain('<w:gridSpan w:val="2"')
  })

  it('does not overflow the page width when explicit widths already fill it', async () => {
    // Two explicit wide columns (700px each = 10500 DXA) plus one column with no
    // width. The missing column must not add a 600 minimum on top; with no
    // remaining space it falls back to the small minimum (200).
    const table: MdNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            cell('W1', { colwidth: [700] }, true),
            cell('W2', { colwidth: [700] }, true),
            cell('empty', undefined, true),
          ],
        },
      ],
    } as MdNode
    const xml = await exportXml(table)
    const gridCols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
    expect(gridCols[0]).toBe(10500)
    expect(gridCols[1]).toBe(10500)
    // Missing column falls back to the small minimum (200), not 600.
    expect(gridCols[2]).toBe(200)
  })
})
