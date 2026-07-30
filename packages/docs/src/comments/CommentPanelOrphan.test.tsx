// Regression gate for the orphaned-comment ROW SHAPE (issue #1181).
//
// The defect this file guards: an orphaned thread used to render the `(orphaned)` label INSTEAD OF
// its quote (`quote ? <quote> : <label>`), so once the anchored text was gone the reader could see
// that the comment was dead but not WHAT it had commented on. The fix renders both. Every
// assertion below would pass on the buggy code only if the label and the quote coexisted, which is
// exactly the property that regressed.
//
// Orphan state is computed in Thread() as `getYBinding(editor) != null && anchorStart != null &&
// anchorRange(editor, thread) == null`, so a test needs a binding that reports READY while anchor
// resolution reports UNRESOLVABLE. Rather than stand up a real Yjs/TipTap binding (covered
// end-to-end by comments/anchor.test.ts and dev/run-orphan.mjs), this file mocks comments/anchor.ts
// — the ONE seam that decides orphanhood — and drives the render through the real CommentPanel.
// That keeps the test about the row markup, which is what #1181 broke.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { CommentThread } from './api.ts'
import type { UseDocComments, CommentMutationResult } from './useDocComments.ts'

// Mutation callbacks are unused by these render-only assertions, but their signatures return
// CommentMutationResult (useDocComments.ts:22), so the stubs must too. Same shape as the sibling
// CommentPanel.test.tsx:17.
const passed: CommentMutationResult = { ok: true, error: null }

// getYBinding -> non-null => "binding is ready"; resolveAnchorRange -> null => "cannot resolve".
// Together those two are precisely the orphan predicate in Thread().
vi.mock('./anchor.ts', () => ({
  getYBinding: () => ({ ydoc: {}, type: {}, mapping: new Map() }),
  decodeRelPos: () => ({}),
  resolveAnchorRange: () => null,
}))

// The mention widgets pull in the host editor stack; the row under test does not involve them.
vi.mock('../mentions/MentionComposer.tsx', () => ({
  MentionComposer: () => null,
}))
vi.mock('../mentions/MentionText.tsx', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}))

const { CommentPanel } = await import('./CommentPanel.tsx')

// `editor` is only read through the mocked anchor seam plus useEditorTick's transaction
// subscription, so a minimal stub is faithful here.
function stubEditor(): Editor {
  return {
    on: () => {},
    off: () => {},
    state: { doc: { content: { size: 1 } } },
  } as unknown as Editor
}

function thread(over: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 1,
    docId: 'd1',
    parentId: null,
    authorUid: 'u_self',
    body: 'body text',
    // anchorStart/End must be non-null: a root with null anchors is NOT orphaned, it is unanchored.
    anchorStart: 'AQI=',
    anchorEnd: 'AQM=',
    anchorText: '第三季度营收同比增长',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    replies: [],
    ...over,
  }
}

function comments(threads: CommentThread[]): UseDocComments {
  return {
    threads,
    loading: false,
    error: null,
    nextCursor: null,
    includeResolved: true,
    setIncludeResolved: () => {},
    refresh: async () => {},
    loadMore: async () => {},
    // Lazy per-thread loading landed on main after this branch forked; these render-only assertions
    // pass fully-materialised threads, so "nothing in flight" + "load always succeeded" is the
    // neutral stub. Mirrors CommentPanel.test.tsx:42,49.
    loadingThreadIds: new Set<number>(),
    loadThread: async () => true,
    createRoot: async () => passed,
    reply: async () => passed,
    editBody: async () => passed,
    resolve: async () => passed,
    remove: async () => passed,
  }
}

function renderPanel(threads: CommentThread[]) {
  return render(
    <CommentPanel
      role="writer"
      editor={stubEditor()}
      comments={comments(threads)}
      activeCommentId={null}
      onSelectComment={() => {}}
    />,
  )
}

const quoteEl = (c: HTMLElement) => c.querySelector('.octo-comment-quote')
const labelEl = (c: HTMLElement) => c.querySelector('.octo-comment-orphan')
const badgeEl = (c: HTMLElement) => c.querySelector('.octo-comment-resolved-badge')

afterEach(() => {
  cleanup()
})
beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommentPanel — orphaned thread row (issue #1181)', () => {
  it('renders the (orphaned) label AND keeps the original quote — not one instead of the other', () => {
    const { container } = renderPanel([thread()])

    const label = labelEl(container)
    const quote = quoteEl(container)
    // Both present is the whole point: the pre-fix markup rendered the label in place of the quote.
    expect(label).not.toBeNull()
    expect(quote).not.toBeNull()
    expect(label!.textContent).toBe('docs.comment.orphaned')
    // The snapshot text itself must survive, not a placeholder.
    expect(quote!.textContent).toContain('第三季度营收同比增长')
    // Marked as historical so it is distinguishable from a live quote without reading the label.
    expect(quote!.className).toContain('is-orphaned')
    // The snapshot is the only surviving record of the anchored text and the row ellipsizes it,
    // so it is also exposed as a tooltip.
    expect(quote!.getAttribute('title')).toBe('第三季度营收同比增长')
  })

  it('still renders the label and a placeholder quote when the snapshot is empty', () => {
    // Pre-#1181 backfilled rows can carry anchorText: ''. The label must not silently become the
    // only content again, and the quote must degrade to the placeholder rather than render '““'.
    const { container } = renderPanel([thread({ anchorText: '' })])

    expect(labelEl(container)).not.toBeNull()
    const quote = quoteEl(container)
    expect(quote).not.toBeNull()
    expect(quote!.textContent).toContain('…')
    expect(quote!.className).toContain('is-orphaned')
    // No tooltip when there is nothing to reveal (title="" would be an empty tooltip in some UAs).
    expect(quote!.getAttribute('title')).toBeNull()
  })

  it('orders label, quote and resolved badge in that sequence when an orphan is also resolved', () => {
    // Orphaned AND resolved puts three flex items in one row — the configuration where the CSS
    // shrink guarantees matter (the badge must not collapse), and where ordering is user-visible.
    const { container } = renderPanel([thread({ resolved: true, resolvedBy: 'u_other', resolvedAt: '2026-01-02T00:00:00Z' })])

    const anchor = container.querySelector('.octo-comment-anchor')!
    expect(labelEl(container)).not.toBeNull()
    expect(quoteEl(container)).not.toBeNull()
    expect(badgeEl(container)).not.toBeNull()

    const classes = Array.from(anchor.children).map((el) => el.className)
    expect(classes).toEqual([
      'octo-comment-orphan',
      'octo-comment-quote is-orphaned',
      'octo-comment-resolved-badge',
    ])
  })

  it('a NON-orphaned thread renders the quote with no label and no is-orphaned marker', () => {
    // Positive control. Without it, a render that dropped the label entirely — or one that marked
    // every quote as orphaned — would still satisfy the assertions above.
    vi.resetModules()
    vi.doMock('./anchor.ts', () => ({
      getYBinding: () => ({ ydoc: {}, type: {}, mapping: new Map() }),
      decodeRelPos: () => ({}),
      resolveAnchorRange: () => ({ from: 4, to: 12 }),
    }))
    return import('./CommentPanel.tsx').then(({ CommentPanel: LivePanel }) => {
      const { container } = render(
        <LivePanel
          role="writer"
          editor={stubEditor()}
          comments={comments([thread()])}
          activeCommentId={null}
          onSelectComment={() => {}}
        />,
      )
      expect(labelEl(container)).toBeNull()
      const quote = quoteEl(container)
      expect(quote).not.toBeNull()
      expect(quote!.className).not.toContain('is-orphaned')
      expect(quote!.textContent).toContain('第三季度营收同比增长')
    })
  })
})

// Guard against the assertions silently passing because the panel rendered nothing at all.
describe('CommentPanel — orphan test harness sanity', () => {
  it('renders one thread row per thread', () => {
    const { container } = renderPanel([thread(), thread({ id: 2 })])
    expect(container.querySelectorAll('.octo-comment-thread').length).toBe(2)
    expect(screen.queryByText('docs.comment.empty')).toBeNull()
  })
})
