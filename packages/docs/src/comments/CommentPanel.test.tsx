import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { CommentThread } from './api.ts'
import type { CommentMutationResult, UseDocComments } from './useDocComments.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { setWKApp } from '../octoweb/index.ts'
import { CommentPanel } from './CommentPanel.tsx'

vi.mock('./anchor.ts', () => ({
  decodeRelPos: vi.fn(),
  getYBinding: () => null,
  resolveAnchorRange: () => null,
}))

const failed = (error: string): CommentMutationResult => ({ ok: false, error })
const passed: CommentMutationResult = { ok: true, error: null }

function thread(id: number, resolved = false): CommentThread {
  return {
    id,
    docId: 'doc-1',
    parentId: null,
    authorUid: 'u_self',
    body: `comment ${id}`,
    anchorStart: null,
    anchorEnd: null,
    anchorText: `row ${id}`,
    resolved,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    replies: [],
  }
}

function comments(overrides: Partial<UseDocComments>): UseDocComments {
  return {
    threads: [],
    loading: false,
    loadingThreadIds: new Set(),
    error: null,
    nextCursor: null,
    includeResolved: true,
    setIncludeResolved: () => {},
    refresh: async () => {},
    loadMore: async () => {},
    loadThread: async () => true,
    createRoot: async () => passed,
    reply: async () => passed,
    editBody: async () => passed,
    resolve: async () => passed,
    remove: async () => passed,
    ...overrides,
  }
}

const editor = {
  state: { doc: { content: { size: 0 } } },
  on: vi.fn(),
  off: vi.fn(),
} as unknown as Editor

beforeEach(() => {
  setWKApp(createMockWKApp())
  Element.prototype.scrollIntoView = vi.fn()
})

describe('CommentPanel mutation failures', () => {
  it('renders delete and resolve/reopen failures as alerts beside only the affected rows', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => failed('Delete row 1 failed.'))
    const resolve = vi.fn(async (id: number, resolved: boolean) =>
      failed(`${resolved ? 'Resolve' : 'Reopen'} row ${id} failed.`),
    )
    render(
      <CommentPanel
        role="writer"
        editor={editor}
        comments={comments({ threads: [thread(1), thread(2), thread(3, true)], remove, resolve })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )

    const row1 = screen.getByText('“row 1”').closest('li')!
    const row2 = screen.getByText('“row 2”').closest('li')!
    const row3 = screen.getByText('“row 3”').closest('li')!

    fireEvent.click(within(row1).getByRole('button', { name: 'docs.comment.delete' }))
    expect((await within(row1).findByRole('alert')).textContent).toBe('Delete row 1 failed.')
    expect(within(row2).queryByRole('alert')).toBeNull()
    expect(within(row3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(row2).getByRole('button', { name: 'docs.comment.resolve' }))
    await waitFor(() => expect(within(row2).getByRole('alert').textContent).toBe('Resolve row 2 failed.'))
    expect(within(row1).getByRole('alert').textContent).toBe('Delete row 1 failed.')
    expect(within(row3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(row3).getByRole('button', { name: 'docs.comment.reopen' }))
    await waitFor(() => expect(within(row3).getByRole('alert').textContent).toBe('Reopen row 3 failed.'))
    expect(resolve).toHaveBeenCalledWith(2, true)
    expect(resolve).toHaveBeenCalledWith(3, false)
  })
})

// Four-role comment matrix (feat: enforce commenter role). reader may VIEW threads but sees no
// reply entry; commenter/writer/admin may reply; resolve/reopen stays writer/admin. The root
// selection composer (CommentBubble) is mounted by EditorShell and gated there — this panel owns
// the reply + resolve gates.
describe('CommentPanel — four-role permission matrix', () => {
  const renderRole = (role: 'reader' | 'commenter' | 'writer' | 'admin') =>
    render(
      <CommentPanel
        role={role}
        editor={editor}
        comments={comments({ threads: [thread(1)] })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )

  it('reader: no reply and no resolve/reopen; thread body still visible', () => {
    renderRole('reader')
    expect(screen.queryByRole('button', { name: 'docs.comment.reply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'docs.comment.resolve' })).toBeNull()
    expect(screen.getByText('comment 1')).toBeTruthy()
  })

  it('commenter: reply present, but no resolve/reopen (cannot edit body)', () => {
    renderRole('commenter')
    expect(screen.getByRole('button', { name: 'docs.comment.reply' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'docs.comment.resolve' })).toBeNull()
  })

  // Body-edit is a writer-level affordance (PATCH contract = author + writer); a commenter author
  // may still soft-delete their own comment (Backend allows commenter self-delete).
  it('commenter author: no edit button on own comment, but delete stays', () => {
    renderRole('commenter')
    expect(screen.queryByRole('button', { name: 'docs.comment.edit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'docs.comment.delete' })).toBeTruthy()
  })

  it('writer author: edit + delete both present on own comment', () => {
    renderRole('writer')
    expect(screen.getByRole('button', { name: 'docs.comment.edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'docs.comment.delete' })).toBeTruthy()
  })

  // Backend #147: DELETE requires the commenter floor, so a reader author must not see soft-delete.
  it('reader author: no delete button (soft-delete needs commenter floor)', () => {
    renderRole('reader')
    expect(screen.queryByRole('button', { name: 'docs.comment.delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'docs.comment.edit' })).toBeNull()
  })

  // Admin hard-deletes even their OWN comment (moderator action, author-agnostic): remove(id, true).
  it('admin author: delete calls remove(id, true)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => passed)
    render(
      <CommentPanel
        role="admin"
        editor={editor}
        comments={comments({ threads: [thread(1)], remove })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1, true))
  })

  for (const role of ['writer', 'admin'] as const) {
    it(`${role}: reply + resolve both present`, () => {
      renderRole(role)
      expect(screen.getByRole('button', { name: 'docs.comment.reply' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'docs.comment.resolve' })).toBeTruthy()
    })
  }
})

// Runtime downgrade fail-closed: an open reply/edit composer must close when the role drops, so a
// stale closure can never submit after commenter->reader / writer->commenter.
describe('CommentPanel — runtime downgrade closes open composers', () => {
  const view = (role: 'reader' | 'commenter' | 'writer' | 'admin', extra: Partial<UseDocComments> = {}) =>
    render(
      <CommentPanel
        role={role}
        editor={editor}
        comments={comments({ threads: [thread(1)], ...extra })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )

  it('commenter->reader closes an open reply composer', () => {
    const { rerender } = view('commenter')
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.reply' }))
    expect(document.querySelector('.octo-mention-composer')).not.toBeNull()
    rerender(
      <CommentPanel
        role="reader"
        editor={editor}
        comments={comments({ threads: [thread(1)] })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )
    expect(document.querySelector('.octo-mention-composer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'docs.comment.reply' })).toBeNull()
  })

  it('writer->commenter closes an open edit composer on own comment', () => {
    const { rerender } = view('writer')
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.edit' }))
    expect(screen.getByRole('button', { name: 'docs.comment.save' })).toBeTruthy()
    rerender(
      <CommentPanel
        role="commenter"
        editor={editor}
        comments={comments({ threads: [thread(1)] })}
        activeCommentId={null}
        onSelectComment={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'docs.comment.save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'docs.comment.edit' })).toBeNull()
  })
})
