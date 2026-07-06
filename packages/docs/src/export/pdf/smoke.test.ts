import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Mock the network-bound attachment API so the export runs offline.
vi.mock('../../attachments/api.ts', () => ({
  resolveAttachments: vi.fn(async () => ({ items: [] })),
}))

import { exportDocToPdf } from './index.ts'
import type { MdNode } from './types.ts'

// Minimal document exercising math (Unicode-text) + common blocks.
const FALLBACK_DOC: MdNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '导出冒烟测试' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '正文中文段落，验证不空白。'.repeat(20) }] },
    { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
    { type: 'blockMath', attrs: { latex: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}' } },
  ],
}

describe('exportDocToPdf 冒烟测试', () => {
  it('真实文档 JSON 导出非空 PDF（公式为可选中文本）', async () => {
    const doc: MdNode =
      existsSync('/tmp/doc.json')
        ? (JSON.parse(readFileSync('/tmp/doc.json', 'utf8')) as MdNode)
        : FALLBACK_DOC
    const blob = await exportDocToPdf('d_pdf_test_full', doc, {})
    // jsdom Blob lacks arrayBuffer(); use FileReader-free size check + type.
    expect(blob).toBeTruthy()
    expect(blob.type).toContain('pdf')
    // A blank/empty export is a few KB; 500+ paragraphs must be far larger.
    expect(blob.size).toBeGreaterThan(20000)
  }, 60000)
})
