import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildPreviewExtensions } from './extensions.ts'

// XIN-1261: a SHRUNK row (an explicit `height` below its content height) must stay shrunk in the
// read-only preview / version diff, not bounce back to content height. The `height` attr alone is only
// a CSS MINIMUM, so making it authoritative needs BOTH the clip decorations (octo-row-fixed +
// --octo-row-h on the <tr>) and the `.octo-cell-clip` content wrapper the clip CSS caps. buildPreviewExtensions
// now registers TableRowClip (the same decoration source the live editor uses) + the cell NodeView, so
// this exercises the real preview extension set headlessly. jsdom does no layout, so we assert the DOM
// contract the clip CSS keys on (class / custom property / wrapper present), not computed pixels — the
// pixel behaviour is verified in a real browser (see the PR verification notes).

const ROW_H = 30

const TABLE_HTML = (rowStyle: string) =>
  '<table><tbody>' +
  `<tr${rowStyle}><td><p>tall line one</p><p>tall line two</p><p>tall line three</p></td><td><p>b</p></td></tr>` +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function makePreview(html: string): Editor {
  const element = document.createElement('div')
  element.className = 'octo-prose'
  document.body.appendChild(element)
  return new Editor({
    element,
    editable: false,
    extensions: buildPreviewExtensions('doc-test'),
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('buildPreviewExtensions row-height clip (XIN-1261)', () => {
  it('tags a row that has an explicit height with octo-row-fixed + --octo-row-h', () => {
    editor = makePreview(TABLE_HTML(` style="height:${ROW_H}px"`))
    const tr = editor.view.dom.querySelector('tr')
    expect(tr).not.toBeNull()
    expect(tr!.classList.contains('octo-row-fixed')).toBe(true)
    // The custom property the clip CSS caps the wrapper against carries the stored height (the CSSOM
    // normalizes spacing, e.g. `--octo-row-h: 30px`, so assert tolerant of whitespace).
    expect(tr!.getAttribute('style') ?? '').toMatch(new RegExp(`--octo-row-h:\\s*${ROW_H}px`))
  })

  it('renders the .octo-cell-clip content wrapper inside each preview cell (the clip target)', () => {
    editor = makePreview(TABLE_HTML(` style="height:${ROW_H}px"`))
    const clips = editor.view.dom.querySelectorAll('td .octo-cell-clip, th .octo-cell-clip')
    // Every cell gets the wrapper (from the shared TableCellView NodeView), so the clip CSS has a target.
    expect(clips.length).toBeGreaterThan(0)
    const firstCellClip = editor.view.dom.querySelector('td .octo-cell-clip')
    expect(firstCellClip).not.toBeNull()
    expect(firstCellClip!.textContent).toContain('tall line one')
  })

  it('does NOT tag a row with no explicit height (v18 content-driven rows are untouched)', () => {
    editor = makePreview(TABLE_HTML(''))
    const rows = editor.view.dom.querySelectorAll('tr')
    for (const tr of rows) {
      expect(tr.classList.contains('octo-row-fixed')).toBe(false)
      expect(tr.getAttribute('style') ?? '').not.toContain('--octo-row-h')
    }
  })
})
