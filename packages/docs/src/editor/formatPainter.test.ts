import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { capturePaintMarks, applyPaintMarks, PAINTABLE_MARK_NAMES } from './formatPainter.ts'

// XIN-963 format painter: record the inline (textStyle-family) marks of a source selection and
// re-apply exactly that set to a target selection, without touching node structure or links.

let editor: Editor | null = null

beforeEach(() => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, underline: false, link: false }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Underline,
      Link,
    ],
    // "boldred" (bold + red) then "plain" then "italic" in separate paragraphs.
    content:
      '<p><strong><span style="color: #ff0000">boldred</span></strong></p>' +
      '<p>plain</p>' +
      '<p><em>italic</em></p>',
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

// Helper: the 1-based document offsets of a paragraph's text run. ProseMirror opens the doc with a
// leading position, so paragraph 1's text spans [1, 1+len].
function selectText(ed: Editor, from: number, to: number) {
  ed.commands.setTextSelection({ from, to })
}

describe('formatPainter — capturePaintMarks', () => {
  it('records the paintable marks of the source selection (bold + textStyle colour)', () => {
    // Select "boldred" (para 1: positions 1..8).
    selectText(editor!, 1, 8)
    const marks = capturePaintMarks(editor!.state)
    const names = marks.map((m) => m.type.name).sort()
    expect(names).toEqual(['bold', 'textStyle'])
    const textStyle = marks.find((m) => m.type.name === 'textStyle')!
    expect(textStyle.attrs.color).toBe('#ff0000')
  })

  it('excludes non-paintable marks (link is never copied)', () => {
    expect(PAINTABLE_MARK_NAMES).not.toContain('link')
    editor!.commands.setContent('<p><a href="https://example.com">linked</a></p>')
    selectText(editor!, 1, 7)
    const marks = capturePaintMarks(editor!.state)
    expect(marks.map((m) => m.type.name)).not.toContain('link')
  })

  it('returns an empty set for a plain-text selection', () => {
    // Para 2 "plain": doc offset starts after para 1 (len 7 + 2 boundary tokens) → 10..15.
    selectText(editor!, 10, 15)
    expect(capturePaintMarks(editor!.state)).toEqual([])
  })
})

describe('formatPainter — applyPaintMarks', () => {
  it('paints the recorded marks onto a target selection', () => {
    // Record bold+red from para 1.
    selectText(editor!, 1, 8)
    const marks = capturePaintMarks(editor!.state)
    // Paint onto "plain" (para 2).
    selectText(editor!, 10, 15)
    const applied = applyPaintMarks(editor!, marks)
    expect(applied).toBe(true)
    expect(editor!.getAttributes('textStyle').color).toBe('#ff0000')
    // Re-select the painted range and confirm bold is active across it.
    selectText(editor!, 10, 15)
    expect(editor!.isActive('bold')).toBe(true)
    expect(editor!.isActive('textStyle', { color: '#ff0000' })).toBe(true)
  })

  it('replaces the target formatting rather than merging it', () => {
    // Record plain (empty mark set) from para 2.
    selectText(editor!, 10, 15)
    const marks = capturePaintMarks(editor!.state)
    expect(marks).toEqual([])
    // Paint onto italic para 3 → italic should be stripped.
    selectText(editor!, 17, 23)
    applyPaintMarks(editor!, marks)
    selectText(editor!, 17, 23)
    expect(editor!.isActive('italic')).toBe(false)
  })

  it('is a no-op on an empty (collapsed) target selection', () => {
    selectText(editor!, 1, 8)
    const marks = capturePaintMarks(editor!.state)
    editor!.commands.setTextSelection(12)
    expect(applyPaintMarks(editor!, marks)).toBe(false)
  })

  it('paint inline code onto linked target preserves link', () => {
    // Source is inline `code`; the `code` mark declares `excludes: '_'`, so adding it to a range
    // makes ProseMirror strip every other mark on that range — including a `link` — and the
    // exclusion is mutual, so code and link cannot share text. Painting a code source onto a
    // target that contains linked text must NOT delete the target's href (data loss). The link
    // portion keeps its href (and does not receive code); any plain portion still gets code.
    editor!.commands.setContent(
      '<p><code>snippet</code></p>' +
        '<p><a href="https://example.com">ab</a>cd</p>',
    )
    // Capture the code mark from the source ("snippet", para 1: 1..8).
    selectText(editor!, 1, 8)
    const marks = capturePaintMarks(editor!.state)
    expect(marks.map((m) => m.type.name)).toContain('code')
    // Paint across the whole target "abcd" (para 2: 10..14) — "ab" is linked, "cd" is plain.
    selectText(editor!, 10, 14)
    const applied = applyPaintMarks(editor!, marks)
    expect(applied).toBe(true)
    // Linked portion "ab": href survives and code was skipped there (would have destroyed it).
    selectText(editor!, 10, 12)
    expect(editor!.isActive('link')).toBe(true)
    expect(editor!.getAttributes('link').href).toBe('https://example.com')
    expect(editor!.isActive('code')).toBe(false)
    // Plain portion "cd": code is applied normally, no link.
    selectText(editor!, 12, 14)
    expect(editor!.isActive('code')).toBe(true)
    expect(editor!.isActive('link')).toBe(false)
  })
})
