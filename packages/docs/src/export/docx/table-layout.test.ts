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

  it('renders an image inside a table cell (regression: cell images were dropped)', async () => {
    // A 1x1 PNG is enough — getImageDimensions falls back to a default box when
    // the bytes do not parse, so the ImageRun still embeds a valid drawing.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ])
    const ctx: DocxContext = {
      urls: new Map([['att_cell_img', { attachId: 'att_cell_img', mime: 'image/png', url: '', fileName: 'x.png' }]]),
      imageBuffers: new Map([['att_cell_img', png.buffer]]),
      dynamicNumbering: [],
      orderedListInstance: 0,
    } as unknown as DocxContext
    const table: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('说明', undefined, true), cell('图', undefined, true)] },
        {
          type: 'tableRow',
          content: [
            cell('单元格文字'),
            {
              type: 'tableCell',
              content: [{ type: 'image', attrs: { attachId: 'att_cell_img', alt: '格内图' } }],
            } as MdNode,
          ],
        },
      ],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(table, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const path = join(tmpdir(), `tbl-img-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(path, buf)
    const xml = execSync(`unzip -p ${path} word/document.xml`).toString()
    // A drawing with an embedded blip must appear inside the table, not vanish.
    expect(xml).toContain('<w:drawing>')
    expect(xml).toMatch(/<a:blip[^>]*r:embed=/)
    // And it must be inside a table cell (<w:tc>), not a stray body paragraph.
    const tcCount = (xml.match(/<w:tc>/g) ?? []).length
    expect(tcCount).toBeGreaterThanOrEqual(4)
  })

  it('renders a nested table (with an image) inside a cell (regression: nested tables/images dropped)', async () => {
    // Regression: a table nested inside a cell hit the text-extract fallback and
    // was dropped entirely, taking any images inside it with it.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ])
    const ctx: DocxContext = {
      urls: new Map([['att_nested_img', { attachId: 'att_nested_img', mime: 'image/png', url: '', fileName: 'n.png' }]]),
      imageBuffers: new Map([['att_nested_img', png.buffer]]),
      dynamicNumbering: [],
      orderedListInstance: 0,
    } as unknown as DocxContext
    const innerTable: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '内层文字' }] }] },
          { type: 'tableCell', content: [{ type: 'image', attrs: { attachId: 'att_nested_img', alt: '内层图' } }] },
        ] },
      ],
    } as MdNode
    const outerTable: MdNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('外层表头', undefined, true)] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '外层单元格，下面是嵌套表' }] },
          innerTable,
        ] }] },
      ],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(outerTable, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const path = join(tmpdir(), `tbl-nested-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(path, buf)
    const xml = execSync(`unzip -p ${path} word/document.xml`).toString()
    // Two tables must exist (outer + nested), i.e. a nested <w:tbl> appears inside a <w:tc>.
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // The nested cell text survives.
    expect(xml).toContain('内层文字')
    // The image inside the nested table is embedded, not dropped.
    expect(xml).toContain('<w:drawing>')
    expect(xml).toMatch(/<a:blip[^>]*r:embed=/)
  })

  it('shrinks a cell image proportionally as it nests deeper (regression: nested img too big)', async () => {
    // 1000x600 intrinsic PNG (IHDR encodes the size). At each level of a 2-column
    // nested table the cell gets narrower, so the image must shrink to fit —
    // previously it kept its page-scale width and looked identical at every depth.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x03, 0xe8, 0x00, 0x00, 0x02, 0x58, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
      0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
      0x60, 0x82,
    ])
    const mkCtx = (): DocxContext =>
      ({
        urls: new Map([['ai', { attachId: 'ai', mime: 'image/png', url: '', fileName: 'i.png' }]]),
        imageBuffers: new Map([['ai', png.buffer]]),
        dynamicNumbering: [],
        orderedListInstance: 0,
      }) as unknown as DocxContext
    const img = (): MdNode => ({ type: 'image', attrs: { attachId: 'ai', alt: 'x' } }) as MdNode
    const tc = (content: unknown[]): MdNode => ({ type: 'tableCell', content }) as MdNode
    const txt = (s: string): MdNode => ({ type: 'paragraph', content: [{ type: 'text', text: s }] }) as MdNode
    const twoCol = (inner: MdNode): MdNode =>
      ({ type: 'table', content: [{ type: 'tableRow', content: [tc([txt('c')]), tc([inner])] }] }) as MdNode
    const imgWidthPx = async (doc: MdNode): Promise<number> => {
      const document = new Document({ sections: [{ children: [convertTable(doc, mkCtx())] }] })
      const buf = await Packer.toBuffer(document)
      const p = join(tmpdir(), `nz-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
      writeFileSync(p, buf)
      const xml = execSync(`unzip -p ${p} word/document.xml`).toString()
      const m = xml.match(/<wp:extent cx="(\d+)"/)
      return m ? Math.round(Number(m[1]) / 9525) : 0
    }
    const l1 = await imgWidthPx(twoCol(img()))
    const l2 = await imgWidthPx(twoCol(twoCol(img())))
    expect(l1).toBeGreaterThan(l2)
    expect(l2).toBeLessThan(300)
  })

  it('sizes a nested table with an absolute DXA width, not 100% pct (regression: inner column collapsed to a sliver)', async () => {
    // A nested table left at width:100% pct made Word fall back to auto layout,
    // where an oversized image in one cell stole the width and collapsed the
    // sibling column to a one-character-per-line sliver. Nested tables must be
    // sized in absolute twips (bounded by their containing cell) so fixed layout
    // keeps the columns even regardless of cell content.
    const ctx: DocxContext = {
      urls: new Map(),
      imageBuffers: new Map(),
      dynamicNumbering: [],
      orderedListInstance: 0,
    } as unknown as DocxContext
    const cell = (s: string): MdNode =>
      ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as MdNode
    const innerTable: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [cell('内层左'), cell('内层右')] }],
    } as MdNode
    const outer: MdNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [cell('外左'), { type: 'tableCell', content: [innerTable] } as MdNode],
        },
      ],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(outer, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const p = join(tmpdir(), `nw-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(p, buf)
    const xml = execSync(`unzip -p ${p} word/document.xml`).toString()
    const tblW = [...xml.matchAll(/<w:tblW w:type="(\w+)" w:w="([0-9%]+)"/g)].map((m) => ({ type: m[1], w: m[2] }))
    // Two tables: the outer (top-level) stays pct 100%, the inner (nested) is dxa.
    expect(tblW.length).toBe(2)
    expect(tblW[0]).toEqual({ type: 'pct', w: '100%' })
    expect(tblW[1].type).toBe('dxa')
    expect(Number(tblW[1].w)).toBeGreaterThan(0)
  })

  it('clamps a lopsided NESTED table so no column collapses to a sliver', async () => {
    // Regression (秒退-era "ffdsaf" vertical-text bug): a nested 3-col table whose
    // editor colwidths are 259px + 14px + 14px would pass through as 3885/209/209
    // twips and Word's fixed layout crushed the 209-twip columns into one char
    // per line. The nested clamp must lift the slivers to a readable share while
    // keeping the wide column widest. Top-level tables are unaffected (see above).
    const ctx = {
      urls: new Map(),
      imageBuffers: new Map(),
      dynamicNumbering: [],
      orderedListInstance: 0,
    } as unknown as DocxContext
    const c = (w: number, s: string): MdNode =>
      ({ type: 'tableCell', attrs: { colwidth: [w] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as MdNode
    const inner: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [c(259, 'ffdsaf'), c(14, 'x'), c(14, 'y')] }],
    } as MdNode
    const outer: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [inner] } as MdNode] }],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(outer, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const p = join(tmpdir(), `lop-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(p, buf)
    const xml = execSync(`unzip -p ${p} word/document.xml`).toString()
    const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map((m) =>
      [...m[1].matchAll(/<w:gridCol w:w="(\d+)"/g)].map((g) => Number(g[1])),
    )
    // The nested (inner) table's grid is the 3-col one.
    const nested = grids.find((g) => g.length === 3)!
    expect(nested).toBeDefined()
    const even = nested.reduce((s, w) => s + w, 0) / 3
    // No column collapses below 0.6x even; wide column still the widest.
    for (const w of nested) expect(w).toBeGreaterThanOrEqual(Math.floor(even * 0.6) - 1)
    expect(nested[0]).toBeGreaterThan(nested[1])
    expect(nested[0]).toBeGreaterThan(nested[2])
  })

  it('keeps a nested table within its cell for inverse-lopsided widths (no overflow)', async () => {
    // Blocker regression: the inverse of the ffdsaf case — one narrow + two wide
    // columns (14px + 259px + 259px). Flooring the narrow column up while the
    // wide columns sit near the max used to push the total past the cell width
    // and re-trigger overflow. The final grid sum must stay within the cell.
    const ctx = {
      urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0,
    } as unknown as DocxContext
    const c = (w: number, s: string): MdNode =>
      ({ type: 'tableCell', attrs: { colwidth: [w] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as MdNode
    const inner: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [c(14, 'n'), c(259, 'wide1'), c(259, 'wide2')] }],
    } as MdNode
    const outer: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [inner] } as MdNode] }],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(outer, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const p = join(tmpdir(), `inv-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(p, buf)
    const xml = execSync(`unzip -p ${p} word/document.xml`).toString()
    const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map((m) =>
      [...m[1].matchAll(/<w:gridCol w:w="(\d+)"/g)].map((g) => Number(g[1])),
    )
    const outerCol = grids.find((g) => g.length === 1)![0]
    const nested = grids.find((g) => g.length === 3)!
    const nestedSum = nested.reduce((s, w) => s + w, 0)
    // Invariant: the nested table never exceeds its containing cell width.
    expect(nestedSum).toBeLessThanOrEqual(outerCol + 2)
  })

  it('keeps a nested mixed-width table within its cell (missing columns branch)', async () => {
    // Blocker regression: partial resize leaves some columns with an explicit
    // colwidth and others without (the common case, since ProseMirror only
    // stores widths for dragged columns). Oversized explicit columns plus an
    // appended minimum sliver used to blow far past the cell (e.g. 2.76-4.93x).
    // The nested mixed branch must fit the whole row to the cell.
    const ctx = {
      urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0,
    } as unknown as DocxContext
    const cW = (w: number, s: string): MdNode =>
      ({ type: 'tableCell', attrs: { colwidth: [w] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as MdNode
    const cNull = (s: string): MdNode =>
      ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as MdNode
    const inner: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [cW(700, 'big1'), cW(700, 'big2'), cNull('rest')] }],
    } as MdNode
    const outer: MdNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [inner] } as MdNode] }],
    } as MdNode
    const document = new Document({ sections: [{ children: [convertTable(outer, ctx)] }] })
    const buf = await Packer.toBuffer(document)
    const p = join(tmpdir(), `mix-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
    writeFileSync(p, buf)
    const xml = execSync(`unzip -p ${p} word/document.xml`).toString()
    const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map((m) =>
      [...m[1].matchAll(/<w:gridCol w:w="(\d+)"/g)].map((g) => Number(g[1])),
    )
    const outerCol = grids.find((g) => g.length === 1)![0]
    const nested = grids.find((g) => g.length === 3)!
    const nestedSum = nested.reduce((s, w) => s + w, 0)
    expect(nestedSum).toBeLessThanOrEqual(outerCol + 2)
  })
})
