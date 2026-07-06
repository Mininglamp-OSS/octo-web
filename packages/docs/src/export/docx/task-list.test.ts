/**
 * Tests for task list (checkbox list) export in DOCX.
 *
 * Task items must export as REAL interactive Word checkboxes (docx CheckBox =
 * a w:sdt content control with w14:checkbox), so they can be clicked/toggled in
 * Word regardless of their initial checked state — not static ☑/☐ glyphs.
 *
 * Also a regression guard for the old "two boxes + double space" bug: exactly
 * one checkbox per item, no duplicated bullet from list numbering.
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

function taskList(items: { text: string; checked: boolean }[]): MdNode {
  return {
    type: 'taskList',
    content: items.map((it) => ({
      type: 'taskItem',
      attrs: { checked: it.checked },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: it.text }] }],
    })),
  } as MdNode
}

async function exportXml(content: MdNode[]) {
  const ctx: DocxContext = { urls: new Map(), imageBuffers: new Map(), dynamicNumbering: [], orderedListInstance: 0 }
  const children = convertBlocks(content, ctx)
  const document = new Document({ styles: DOCX_STYLES, numbering: NUMBERING_CONFIG, sections: [{ children }] })
  const buf = await Packer.toBuffer(document)
  const path = join(tmpdir(), `task-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
  writeFileSync(path, buf)
  return execSync(`unzip -p ${path} word/document.xml`).toString()
}

const count = (s: string, sub: string) => s.split(sub).length - 1

describe('task list export', () => {
  it('every item is an interactive checkbox content control (w:sdt + w14:checkbox)', async () => {
    const xml = await exportXml([
      taskList([
        { text: '完成的任务', checked: true },
        { text: '未完成的任务', checked: false },
      ]),
    ])
    // Both items must be real toggleable Word checkboxes, not static glyphs.
    expect(count(xml, '<w14:checkbox>')).toBe(2)
    expect(count(xml, '<w:sdt>')).toBe(2)
  })

  it('checked vs unchecked initial state is preserved', async () => {
    const xml = await exportXml([
      taskList([
        { text: '完成的任务', checked: true },
        { text: '未完成的任务', checked: false },
      ]),
    ])
    // Checked box → w14:checked val="1"; unchecked → val="0". Checked state renders
    // a check mark ☑ (2611), NOT an X ☒ (2612).
    expect(xml).toContain('<w14:checked w14:val="1"/>')
    expect(xml).toContain('<w14:checked w14:val="0"/>')
    expect(xml).toContain('w14:val="2611"')
    expect(xml).not.toContain('w14:val="2612"')
    // Both remain interactive regardless of initial state (same content-control markup).
    expect(count(xml, 'w14:checkbox')).toBeGreaterThanOrEqual(2)
  })

  it('exactly one checkbox per item — no duplicate boxes', async () => {
    const xml = await exportXml([
      taskList([
        { text: 'a', checked: true },
        { text: 'b', checked: false },
        { text: 'c', checked: false },
      ]),
    ])
    // 3 items → exactly 3 checkbox content controls, no extra bullet boxes.
    expect(count(xml, '<w14:checkbox>')).toBe(3)
    // No leftover static glyphs.
    expect(xml).not.toContain('☑')
    expect(xml).not.toContain('☐')
  })

  it('nested task list keeps its own interactive checkboxes', async () => {
    const nested: MdNode = {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '父任务' }] },
            taskList([
              { text: '子任务已完成', checked: true },
              { text: '子任务未完成', checked: false },
            ]),
          ],
        },
      ],
    } as MdNode
    const xml = await exportXml([nested])
    // parent + 2 children = 3 checkboxes
    expect(count(xml, '<w14:checkbox>')).toBe(3)
    expect(xml).toContain('<w14:checked w14:val="1"/>')
    expect(xml).toContain('<w14:checked w14:val="0"/>')
  })
})
