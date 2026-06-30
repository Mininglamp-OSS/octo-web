import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { buildEmoji } from './emoji.ts'
import { buildMention } from './mention.ts'
import {
  findMatches,
  planReplaceAll,
  FindReplace,
  getFindState,
  revealMatchInView,
  expandAncestorDetails,
} from './findReplace.ts'

function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), FindReplace],
    content: html,
  })
}

/** Editor with the collapsible details nodes registered, for expand-on-reveal tests. */
function makeDetailsEditor(html: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      FindReplace,
    ],
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

// Regression (yujiawei P1 #2): a Find&Replace whose match spanned an inline-atom node (emoji /
// mention) used to splice across it with insertText(from,to), silently DELETING the atom. The
// scanner must treat an inline atom as a hard boundary so a match can neither span nor replace
// across it.
describe('find & replace never deletes an inline atom (emoji / mention)', () => {
  /** Editor with the emoji + mention inline-atom nodes registered. */
  function makeAtomEditor(content: object): Editor {
    return new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), buildEmoji(), buildMention({}), FindReplace],
      content,
    })
  }
  const para = (...inline: object[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: inline }] })
  const txt = (text: string) => ({ type: 'text', text })
  const mention = () => ({ type: 'mention', attrs: { id: 'u1', label: 'alice', type: 'user' } })
  const emoji = () => ({ type: 'emoji', attrs: { name: 'smile' } })
  function countNodes(name: string): number {
    let n = 0
    editor!.state.doc.descendants((node) => {
      if (node.type.name === name) n += 1
    })
    return n
  }

  it('does not produce a match that spans a mention atom', () => {
    // Text "foo" + @mention + "bar"; naive concatenation would be "foobar" and match "oob"
    // across the mention. The atom boundary must prevent that.
    editor = makeAtomEditor(para(txt('foo'), mention(), txt('bar')))
    expect(countNodes('mention')).toBe(1)
    expect(findMatches(editor.state.doc, 'oob')).toEqual([])
  })

  it('replaceAll of a cross-atom term leaves the mention intact', () => {
    editor = makeAtomEditor(para(txt('foo'), mention(), txt('bar')))
    editor.commands.setFindQuery('oob')
    editor.commands.replaceAll('XX')
    expect(countNodes('mention')).toBe(1) // atom survived
  })

  it('does not produce a match that spans an emoji atom', () => {
    editor = makeAtomEditor(para(txt('foo'), emoji(), txt('bar')))
    expect(countNodes('emoji')).toBe(1)
    expect(findMatches(editor.state.doc, 'oob')).toEqual([])
    editor.commands.setFindQuery('oob')
    editor.commands.replaceAll('XX')
    expect(countNodes('emoji')).toBe(1)
  })

  it('still finds + replaces matches on each side of an atom, keeping the atom', () => {
    // "cat" + @mention + "cat": two independent matches, neither crossing the atom.
    editor = makeAtomEditor(para(txt('cat'), mention(), txt('cat')))
    editor.commands.setFindQuery('cat')
    expect(getFindState(editor.state).matches).toHaveLength(2)
    editor.commands.replaceAll('dog')
    expect(countNodes('mention')).toBe(1) // atom untouched between the two replacements
    expect(editor.getText()).toContain('dog')
    expect(editor.getText()).not.toContain('cat')
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

describe('revealMatchInView (scroll-to-match)', () => {
  // A minimal fake of the pieces revealMatchInView reads: a scroll container with geometry, an
  // editor DOM whose closest scrollable ancestor is that container, and coordsAtPos. jsdom has no
  // real layout, so we synthesize rects.
  function makeFakeView(opts: {
    matchTop: number
    matchBottom: number
    scrollerRect: { top: number; bottom: number }
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    stickyHeight: number
  }) {
    const scrollTo = vi.fn()
    const wrap = {
      getBoundingClientRect: () => ({ height: opts.stickyHeight }),
    }
    const scroller = {
      classList: { contains: (c: string) => c === 'octo-doc--editor' },
      getBoundingClientRect: () => opts.scrollerRect,
      querySelector: (sel: string) => (sel === '.octo-toolbar-wrap' ? wrap : null),
      scrollTop: opts.scrollTop,
      scrollHeight: opts.scrollHeight,
      clientHeight: opts.clientHeight,
      scrollTo,
      parentElement: null,
    } as unknown as HTMLElement
    const dom = {
      classList: { contains: () => false },
      parentElement: scroller,
      ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowY: 'visible' }) } },
    } as unknown as HTMLElement
    const view = {
      dom,
      coordsAtPos: () => ({ top: opts.matchTop, bottom: opts.matchBottom, left: 0, right: 10 }),
    }
    return { view, scrollTo }
  }

  it('returns false when there is no live view', () => {
    expect(revealMatchInView(null, 5)).toBe(false)
    expect(revealMatchInView(undefined, 5)).toBe(false)
  })

  it('scrolls an off-screen (below the fold) match into the usable band', () => {
    // Scroll container occupies viewport 0..600; sticky header 100px tall. Match is at 1200 —
    // far below the visible area → must scroll down.
    const { view, scrollTo } = makeFakeView({
      matchTop: 1200,
      matchBottom: 1220,
      scrollerRect: { top: 0, bottom: 600 },
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 600,
      stickyHeight: 100,
    })
    expect(revealMatchInView(view as never, 42)).toBe(true)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    const arg = scrollTo.mock.calls[0][0] as { top: number }
    expect(arg.top).toBeGreaterThan(0) // scrolled downward toward the match
  })

  it('does not scroll when the match is already comfortably visible', () => {
    // Match at 300..320, usable band ~112..588 → already inside, no scroll.
    const { view, scrollTo } = makeFakeView({
      matchTop: 300,
      matchBottom: 320,
      scrollerRect: { top: 0, bottom: 600 },
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 600,
      stickyHeight: 100,
    })
    expect(revealMatchInView(view as never, 42)).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('keeps a match hidden behind the sticky header out, scrolling it below the header', () => {
    // Match at top=40 sits under the 100px sticky header (usable band starts ~112) → scroll up.
    const { view, scrollTo } = makeFakeView({
      matchTop: 40,
      matchBottom: 60,
      scrollerRect: { top: 0, bottom: 600 },
      scrollTop: 500,
      scrollHeight: 5000,
      clientHeight: 600,
      stickyHeight: 100,
    })
    expect(revealMatchInView(view as never, 42)).toBe(true)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    const arg = scrollTo.mock.calls[0][0] as { top: number }
    expect(arg.top).toBeLessThan(500) // scrolled upward to clear the sticky header
  })
})

describe('expandAncestorDetails (reveal matches hidden in collapsed details)', () => {
  it('opens a collapsed details that contains the position', () => {
    editor = makeDetailsEditor(
      '<details><summary>head</summary><div data-type="detailsContent"><p>find asterisk</p></div></details>',
    )
    // Locate the "as" match inside the (closed) details content.
    const matches = findMatches(editor.state.doc, 'as')
    expect(matches.length).toBeGreaterThan(0)
    const pos = matches[0].from

    // Sanity: the enclosing details starts closed.
    let detailsClosed = false
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'details' && !node.attrs.open) detailsClosed = true
    })
    expect(detailsClosed).toBe(true)

    const opened = expandAncestorDetails(editor.state, editor.view.dispatch, pos)
    expect(opened).toBe(true)

    let anyOpen = false
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'details' && node.attrs.open) anyOpen = true
    })
    expect(anyOpen).toBe(true)
  })

  it('opens every level of nested collapsed details on the path to the match', () => {
    editor = makeDetailsEditor(
      '<details><summary>outer</summary><div data-type="detailsContent">' +
        '<details><summary>inner</summary><div data-type="detailsContent"><p>deep asterisk</p></div></details>' +
        '</div></details>',
    )
    const pos = findMatches(editor.state.doc, 'as')[0].from
    const opened = expandAncestorDetails(editor.state, editor.view.dispatch, pos)
    expect(opened).toBe(true)

    // Both the outer and inner details should now be open.
    let openCount = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'details' && node.attrs.open) openCount += 1
    })
    expect(openCount).toBe(2)
  })

  it('is a no-op (returns false) when the details on the path is already open', () => {
    editor = makeDetailsEditor(
      '<details open><summary>head</summary><div data-type="detailsContent"><p>open asterisk</p></div></details>',
    )
    const pos = findMatches(editor.state.doc, 'as')[0].from
    expect(expandAncestorDetails(editor.state, editor.view.dispatch, pos)).toBe(false)
  })

  it('returns false for a position not inside any details', () => {
    editor = makeDetailsEditor('<p>plain asterisk paragraph</p>')
    const pos = findMatches(editor.state.doc, 'as')[0].from
    expect(expandAncestorDetails(editor.state, editor.view.dispatch, pos)).toBe(false)
  })

  it('returns false when the details node type is not registered', () => {
    editor = makeEditor('<p>plain asterisk</p>')
    const pos = findMatches(editor.state.doc, 'as')[0].from
    expect(expandAncestorDetails(editor.state, editor.view.dispatch, pos)).toBe(false)
  })
})
