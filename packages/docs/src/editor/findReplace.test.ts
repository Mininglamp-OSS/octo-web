import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { findMatches, planReplaceAll, FindReplace, getFindState } from './findReplace.ts'

function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), FindReplace],
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('findMatches (pure scanner)', () => {
  it('returns no matches for an empty query', () => {
    editor = makeEditor('<p>hello world</p>')
    expect(findMatches(editor.state.doc, '')).toEqual([])
  })

  it('finds all case-insensitive occurrences with correct positions', () => {
    editor = makeEditor('<p>foo Foo foo</p>')
    const matches = findMatches(editor.state.doc, 'foo')
    expect(matches).toHaveLength(3)
    // The matched ranges actually contain the term (case-insensitively).
    for (const m of matches) {
      expect(editor.state.doc.textBetween(m.from, m.to).toLowerCase()).toBe('foo')
    }
  })

  it('respects case sensitivity', () => {
    editor = makeEditor('<p>foo Foo foo</p>')
    const matches = findMatches(editor.state.doc, 'foo', { caseSensitive: true })
    expect(matches).toHaveLength(2)
  })

  it('finds matches across multiple blocks', () => {
    editor = makeEditor('<p>alpha</p><h2>alpha beta</h2>')
    expect(findMatches(editor.state.doc, 'alpha')).toHaveLength(2)
  })

  it('matches a term that spans adjacent mark-split text nodes', () => {
    // "He" is bold, "llo" is plain → two text nodes; "hello" should still match.
    editor = makeEditor('<p><strong>He</strong>llo</p>')
    const matches = findMatches(editor.state.doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(editor.state.doc.textBetween(matches[0].from, matches[0].to).toLowerCase()).toBe('hello')
  })

  it('does not match across block boundaries', () => {
    editor = makeEditor('<p>foo</p><p>bar</p>')
    expect(findMatches(editor.state.doc, 'foobar')).toEqual([])
  })
})

describe('planReplaceAll', () => {
  it('orders edits right-to-left so positions stay valid while splicing', () => {
    const planned = planReplaceAll([
      { from: 1, to: 4 },
      { from: 10, to: 13 },
      { from: 5, to: 8 },
    ])
    expect(planned.map((m) => m.from)).toEqual([10, 5, 1])
  })
})

describe('FindReplace commands + decorations', () => {
  it('tracks matches and the current index, advancing with findNext (wrapping)', () => {
    editor = makeEditor('<p>foo foo foo</p>')
    editor.commands.setFindQuery('foo')
    let fs = getFindState(editor.state)
    expect(fs.matches).toHaveLength(3)
    expect(fs.index).toBe(0)

    editor.commands.findNext()
    expect(getFindState(editor.state).index).toBe(1)
    editor.commands.findNext()
    editor.commands.findNext()
    // Wraps back to the first match.
    expect(getFindState(editor.state).index).toBe(0)

    editor.commands.findPrev()
    expect(getFindState(editor.state).index).toBe(2)
  })

  it('replaceCurrent replaces only the current match', () => {
    editor = makeEditor('<p>cat cat cat</p>')
    editor.commands.setFindQuery('cat')
    editor.commands.replaceCurrent('dog')
    expect(editor.getText()).toBe('dog cat cat')
    // The search keeps running; two matches remain.
    expect(getFindState(editor.state).matches).toHaveLength(2)
  })

  it('replaceAll replaces every match', () => {
    editor = makeEditor('<p>cat cat cat</p>')
    editor.commands.setFindQuery('cat')
    editor.commands.replaceAll('dog')
    expect(editor.getText()).toBe('dog dog dog')
    expect(getFindState(editor.state).matches).toHaveLength(0)
  })

  it('clearFind empties the search state', () => {
    editor = makeEditor('<p>foo foo</p>')
    editor.commands.setFindQuery('foo')
    expect(getFindState(editor.state).matches).toHaveLength(2)
    editor.commands.clearFind()
    const fs = getFindState(editor.state)
    expect(fs.query).toBe('')
    expect(fs.matches).toHaveLength(0)
    expect(fs.index).toBe(-1)
  })

  it('exposes inline decorations for every match', () => {
    editor = makeEditor('<p>foo foo</p>')
    editor.commands.setFindQuery('foo')
    const fs = getFindState(editor.state)
    const decos = fs.decorations.find()
    expect(decos).toHaveLength(2)
  })
})
