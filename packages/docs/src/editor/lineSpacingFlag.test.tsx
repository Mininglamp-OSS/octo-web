import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Toolbar } from './Toolbar.tsx'
import { LineHeight } from './LineHeight.ts'
import { buildPreviewExtensions } from './extensions.ts'

// LINE_SPACING_ENABLED kill switch (SCHEMA_VERSION 17, boss policy A).
//
// The flag defaults ON — the ON path is already exercised by the "paragraph spacing controls"
// and "custom line-height input" suites in Toolbar.test.tsx, which mount the toolbar with the
// real (unset → ON) flag and find the controls. This file pins the OFF path: an explicit
// VITE_DOCS_LINE_SPACING=false hides every line-spacing toolbar control, while the LineHeight
// extension stays registered so the schema still round-trips the attrs (collab-lossless).
vi.mock('../config.ts', async (importActual) => {
  const actual = await importActual<typeof import('../config.ts')>()
  return { ...actual, LINE_SPACING_ENABLED: false }
})

afterEach(() => cleanup())

const LINE_SPACING_TITLES = [
  'docs.toolbar.lineHeight',
  'docs.toolbar.spaceBefore',
  'docs.toolbar.spaceAfter',
]

describe('LINE_SPACING_ENABLED=false — toolbar UI gated off', () => {
  it('renders none of the line-spacing controls when the flag is off', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), LineHeight],
      content: '<p>hello</p>',
    })
    const { container } = render(<Toolbar editor={editor} />)
    for (const title of LINE_SPACING_TITLES) {
      expect(
        container.querySelector(`[title="${title}"]`),
        `control "${title}" should be hidden when the flag is off`,
      ).toBeNull()
    }
    editor.destroy()
  })

  it('keeps the schema registering the line-spacing attrs regardless of the flag', () => {
    // Registration lives in the LineHeight extension, not behind the flag — so an OFF toolbar
    // still opens/edits/syncs documents that carry these attrs without stripping them.
    const schema = getSchema(buildPreviewExtensions('doc-test'))
    for (const attr of ['lineHeight', 'spaceBefore', 'spaceAfter']) {
      expect(schema.nodes.paragraph.spec.attrs?.[attr], `paragraph missing ${attr}`).toBeDefined()
      expect(schema.nodes.heading.spec.attrs?.[attr], `heading missing ${attr}`).toBeDefined()
    }
  })
})
