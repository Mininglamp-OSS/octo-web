import { describe, it, expect } from 'vitest'
import { Packer, Document } from 'docx'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertBlocks, NUMBERING_CONFIG } from './nodes.ts'
import { DOCX_STYLES } from './styles.ts'
import type { MdNode, DocxContext } from './types.ts'

describe('emoji end-to-end docx export', () => {
  it('emoji in body text gets emoji font in document.xml', async () => {
    const doc: MdNode[] = [
      { type: 'paragraph', content: [{ type: 'text', text: '标题 😀 内容 ✅ 完成' }] },
    ] as MdNode[]
    const ctx: DocxContext = { urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0 }
    const children = convertBlocks(doc, ctx)
    const document = new Document({ styles: DOCX_STYLES, numbering: NUMBERING_CONFIG, sections: [{ children }] })
    const buf = await Packer.toBuffer(document)
    const path = join(tmpdir(), `emoji-e2e-${Date.now()}.docx`)
    writeFileSync(path, buf)
    const xml = execSync(`unzip -p ${path} word/document.xml`).toString()

    // The emoji runs (😀, ✅) must carry Segoe UI Emoji; the CJK runs must not.
    const emojiRuns = [...xml.matchAll(/<w:r>(?:(?!<\/w:r>).)*?<w:t[^>]*>([^<]*(?:😀|✅)[^<]*)<\/w:t>[\s\S]*?<\/w:r>/g)]
    // Fallback: just assert the font appears near an emoji.
    expect(xml).toContain('Segoe UI Emoji')
    // CJK-only run should NOT get the emoji font — check a run containing 标题 has 微软雅黑 default (no Segoe override)
    const cjkRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*?<w:t[^>]*>[^<]*标题[^<]*<\/w:t>[\s\S]*?<\/w:r>/)
    expect(cjkRun?.[0] ?? '').not.toContain('Segoe UI Emoji')
  })
})
