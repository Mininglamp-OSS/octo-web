import { describe, it, expect } from 'vitest'
import { Packer, Document } from 'docx'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertBlocks, NUMBERING_CONFIG } from './nodes.ts'
import { DOCX_STYLES } from './styles.ts'
import type { MdNode, DocxContext } from './types.ts'

async function exportXml(content: MdNode[], urls?: Map<string, any>) {
  const ctx: DocxContext = {
    urls: urls ?? new Map(),
    imageBuffers: new Map(),
    dynamicNumbering: [],
    orderedListInstance: 0,
  }
  const children = convertBlocks(content, ctx)
  const document = new Document({ styles: DOCX_STYLES, numbering: NUMBERING_CONFIG, sections: [{ children }] })
  const buf = await Packer.toBuffer(document)
  const path = join(tmpdir(), `attach-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
  writeFileSync(path, buf)
  return execSync(`unzip -p ${path} word/document.xml`).toString()
}

describe('file attachment export', () => {
  it('resolved attachment renders as hyperlink with filename', async () => {
    const urls = new Map<string, any>([
      ['a1', { url: 'https://cdn.example.com/report.pdf', fileName: '季度报告.pdf' }],
    ])
    const doc: MdNode[] = [
      { type: 'fileAttachment', attrs: { attachId: 'a1', fileName: '季度报告.pdf' } },
    ] as MdNode[]
    const xml = await exportXml(doc, urls)
    expect(xml).toContain('季度报告.pdf')
    expect(xml).toContain('Hyperlink')
    // hyperlink relationship should point at the url (external link stored in rels)
    expect(xml).toMatch(/w:hyperlink/i)
  })

  it('unresolved attachment shows (unavailable) fallback', async () => {
    const doc: MdNode[] = [
      { type: 'fileAttachment', attrs: { fileName: '缺失文件.zip' } },
    ] as MdNode[]
    const xml = await exportXml(doc)
    expect(xml).toContain('缺失文件.zip')
    expect(xml).toContain('unavailable')
    // The 📎 icon in the unavailable branch must also carry the emoji font.
    expect(xml).toContain('Segoe UI Emoji')
  })

  it('attachment 📎 icon carries an emoji font (not blank)', async () => {
    const urls = new Map<string, any>([
      ['a1', { url: 'https://cdn.example.com/x.pdf', fileName: 'x.pdf' }],
    ])
    const doc: MdNode[] = [{ type: 'fileAttachment', attrs: { attachId: 'a1' } }] as MdNode[]
    const xml = await exportXml(doc, urls)
    // The 📎 run must have an emoji font so it does not render blank.
    expect(xml).toContain('Segoe UI Emoji')
  })
})
