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
