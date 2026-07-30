import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentThread } from '../comments/api.ts'
import type { CommentMutationResult, UseDocComments } from '../comments/useDocComments.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { setWKApp } from '../octoweb/index.ts'
import { BoardCommentPanel } from './BoardCommentPanel.tsx'
import { BoardInlineCommentComposer } from './BoardInlineCommentComposer.tsx'
import { encodeBoardCommentAnchor } from './boardCommentAnchor.ts'

vi.mock('../mentions/MentionComposer.tsx', () => ({
  MentionComposer: ({ initialBody = '', onChange }: { initialBody?: string; onChange: (body: string) => void }) => (
    <textarea aria-label="comment draft" defaultValue={initialBody} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const failed = (message: string): CommentMutationResult => ({ ok: false, error: message })
const passed: CommentMutationResult = { ok: true, error: null }

function comment(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 1,
    docId: 'doc-1',
    parentId: null,
    authorUid: 'u_self',
    body: 'existing comment',
    anchorStart: encodeBoardCommentAnchor({ version: 1, kind: 'point', x: 10, y: 20 }),
    anchorEnd: encodeBoardCommentAnchor({ version: 1, kind: 'point', x: 10, y: 20 }),
    anchorText: 'Canvas point',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    replies: [],
    ...overrides,
  }
}

function comments(overrides: Partial<UseDocComments> = {}): UseDocComments {
  return {
    threads: [],
    loading: false,
    loadingThreadIds: new Set(),
    error: null,
    nextCursor: null,
    includeResolved: false,
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

beforeEach(() => {
  setWKApp(createMockWKApp())
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Board comment mutation failures', () => {
  it('keeps the inline composer open, preserves its draft, and shows the local create error', async () => {
    const createRoot = vi.fn(async () => failed('Failed to add comment.'))
    const onClose = vi.fn()
    render(
      <BoardInlineCommentComposer
        target={{ anchor: { version: 1, kind: 'point', x: 10, y: 20 }, label: 'Canvas point' }}
        left={10}
        top={20}
        dark={false}
        comments={comments({ createRoot })}
        onClose={onClose}
      />,
    )

    const draft = screen.getByLabelText('comment draft')
    fireEvent.change(draft, { target: { value: 'keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.sheet.comment.menu' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to add comment.')
    expect((draft as HTMLTextAreaElement).value).toBe('keep this draft')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a thrown submit failure and keeps the inline draft open', async () => {
    const createRoot = vi.fn(async () => { throw new Error('Network unavailable.') })
    const onClose = vi.fn()
    render(
      <BoardInlineCommentComposer
        target={{ anchor: { version: 1, kind: 'point', x: 10, y: 20 }, label: 'Canvas point' }}
        left={10}
        top={20}
        dark={false}
        comments={comments({ createRoot })}
        onClose={onClose}
      />,
    )
    const draft = screen.getByLabelText('comment draft')
    fireEvent.change(draft, { target: { value: 'retry me' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.sheet.comment.menu' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Network unavailable.')
    expect((draft as HTMLTextAreaElement).value).toBe('retry me')
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    ['empty list', []],
    ['an existing first page', [comment({ id: 1 })]],
  ])('shows direct hydration loading with %s and hides it after the target arrives', async (_label, initialThreads) => {
    const { rerender } = render(
      <BoardCommentPanel
        role="writer"
        comments={comments({ threads: initialThreads, loadingThreadIds: new Set([9]) })}
        names={new Map()}
        activeCommentId={9}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('docs.comment.loading')).not.toBeNull()
    expect(screen.queryByText('docs.board.comment.empty')).toBeNull()

    const target = comment({ id: 9, body: 'Hydrated target' })
    rerender(
      <BoardCommentPanel
        role="writer"
        comments={comments({ threads: [...initialThreads, target], loadingThreadIds: new Set() })}
        names={new Map()}
        activeCommentId={9}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText('docs.comment.loading')).toBeNull()
    expect(screen.getByText('Hydrated target')).not.toBeNull()
  })

  it('keeps the panel create draft when createRoot throws', async () => {
    const createRoot = vi.fn(async () => { throw new Error('Create threw.') })
    render(
      <BoardCommentPanel
        role="writer" comments={comments({ createRoot })} names={new Map()} activeCommentId={null}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined} onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.board.comment.add' }))
    const draft = screen.getByLabelText('comment draft')
    fireEvent.change(draft, { target: { value: 'keep create' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.send' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Create threw.')
    expect((draft as HTMLTextAreaElement).value).toBe('keep create')
  })

  it('keeps reply and edit drafts when their mutations throw', async () => {
    const reply = vi.fn(async () => { throw new Error('Reply threw.') })
    const editBody = vi.fn(async () => { throw new Error('Edit threw.') })
    render(
      <BoardCommentPanel
        role="writer" comments={comments({ threads: [comment()], reply, editBody })}
        names={new Map([['u_self', 'Me']])} activeCommentId={1} onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined} onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.reply' }))
    const replyDraft = screen.getByPlaceholderText('docs.comment.replyPlaceholder')
    fireEvent.change(replyDraft, { target: { value: 'keep reply' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'docs.comment.reply' }).at(-1)!)
    expect((await screen.findByText('Reply threw.')).textContent).toBe('Reply threw.')
    expect((replyDraft as HTMLTextAreaElement).value).toBe('keep reply')

    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.edit' }))
    const editDraft = screen.getByDisplayValue('existing comment')
    fireEvent.change(editDraft, { target: { value: 'keep edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.save' }))
    expect((await screen.findByText('Edit threw.')).textContent).toBe('Edit threw.')
    expect((editDraft as HTMLTextAreaElement).value).toBe('keep edit')
  })

  it('shows local errors when delete and resolve throw', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => { throw new Error('Delete threw.') })
    const resolve = vi.fn(async () => { throw new Error('Resolve threw.') })
    render(
      <BoardCommentPanel
        role="writer" comments={comments({ threads: [comment()], remove, resolve })}
        names={new Map([['u_self', 'Me']])} activeCommentId={1} onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined} onClose={() => {}}
      />,
    )
    const thread = screen.getByRole('listitem')
    fireEvent.click(within(thread).getByRole('button', { name: 'docs.comment.delete' }))
    expect((await screen.findByText('Delete threw.')).textContent).toBe('Delete threw.')
    fireEvent.click(within(thread).getByRole('button', { name: 'docs.comment.resolve' }))
    expect((await screen.findByText('Resolve threw.')).textContent).toBe('Resolve threw.')
  })

  it('keeps reply text and reply mode open when posting fails', async () => {
    const reply = vi.fn(async () => failed('Failed to post reply.'))
    render(
      <BoardCommentPanel
        role="writer"
        comments={comments({ threads: [comment()], error: 'Failed to post reply.', reply })}
        names={new Map([['u_self', 'Me']])}
        activeCommentId={1}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined}
        onClose={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.reply' }))
    const draft = screen.getByPlaceholderText('docs.comment.replyPlaceholder')
    fireEvent.change(draft, { target: { value: 'keep this reply' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'docs.comment.reply' }).at(-1)!)

    await waitFor(() => expect(reply).toHaveBeenCalled())
    expect((draft as HTMLTextAreaElement).value).toBe('keep this reply')
    expect(screen.getByPlaceholderText('docs.comment.replyPlaceholder')).not.toBeNull()
  })

  it('keeps edit mode and the edited draft when saving fails', async () => {
    const editBody = vi.fn(async () => failed('Failed to save edit.'))
    render(
      <BoardCommentPanel
        role="writer"
        comments={comments({ threads: [comment()], error: 'Failed to save edit.', editBody })}
        names={new Map([['u_self', 'Me']])}
        activeCommentId={1}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined}
        onClose={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.edit' }))
    const draft = screen.getByDisplayValue('existing comment')
    fireEvent.change(draft, { target: { value: 'keep this edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.save' }))

    await waitFor(() => expect(editBody).toHaveBeenCalled())
    expect((draft as HTMLTextAreaElement).value).toBe('keep this edit')
    expect(screen.getByRole('button', { name: 'docs.comment.save' })).not.toBeNull()
  })
  it('renders delete and resolve/reopen failures as alerts beside only the affected threads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => failed('Delete thread 1 failed.'))
    const resolve = vi.fn(async (id: number, resolved: boolean) =>
      failed(`${resolved ? 'Resolve' : 'Reopen'} thread ${id} failed.`),
    )
    render(
      <BoardCommentPanel
        role="writer"
        comments={comments({
          threads: [
            comment({ id: 1, anchorText: 'Canvas point 1' }),
            comment({ id: 2, anchorText: 'Canvas point 2' }),
            comment({ id: 3, anchorText: 'Canvas point 3', resolved: true }),
          ],
          remove,
          resolve,
        })}
        names={new Map([['u_self', 'Me']])}
        activeCommentId={1}
        onActivate={() => {}}
        getTarget={() => ({ anchor: { version: 1, kind: 'point', x: 1, y: 2 }, label: 'Point' })}
        getElementType={() => undefined}
        onClose={() => {}}
      />,
    )

    const [thread1, thread2, thread3] = screen.getAllByRole('listitem')

    fireEvent.click(within(thread1).getByRole('button', { name: 'docs.comment.delete' }))
    expect((await within(thread1).findByRole('alert')).textContent).toBe('Delete thread 1 failed.')
    expect(within(thread2).queryByRole('alert')).toBeNull()
    expect(within(thread3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(thread2).getByRole('button', { name: 'docs.comment.resolve' }))
    await waitFor(() => expect(within(thread2).getByRole('alert').textContent).toBe('Resolve thread 2 failed.'))
    expect(within(thread1).getByRole('alert').textContent).toBe('Delete thread 1 failed.')
    expect(within(thread3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(thread3).getByRole('button', { name: 'docs.comment.reopen' }))
    await waitFor(() => expect(within(thread3).getByRole('alert').textContent).toBe('Reopen thread 3 failed.'))
    expect(resolve).toHaveBeenCalledWith(2, true)
    expect(resolve).toHaveBeenCalledWith(3, false)
  })
})
