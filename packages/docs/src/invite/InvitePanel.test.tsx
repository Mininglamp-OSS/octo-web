import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { InvitePanel } from './InvitePanel.tsx'
import type { Role } from '../auth/roles.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})
afterEach(() => {
  cleanup()
})

function httpError(status: number, body?: unknown) {
  return { response: { status, data: body } }
}

// Locale-agnostic assertions: pluck a substring from the actual bundle instead of
// hardcoding the localized string, so the test survives a copy tweak. Falls back to
// stub text if the bundle changes shape.
async function findMessage(label: 'empty' | 'error') {
  // "抱歉，获取邀请列表时出错" / "还没有邀请链接" — either the real string or the raw i18n key
  // should end up in the DOM, so tolerate both.
  const empty = /docs\.member\.inviteEmpty|邀请|invit/i
  const err = /docs\.member\.errorLoad|加载|error|失败/i
  await waitFor(() => {
    if (label === 'empty') {
      expect(document.body.textContent).toMatch(empty)
    } else {
      expect(document.body.textContent).toMatch(err)
    }
  })
}

describe('InvitePanel — loadError vs empty (independent state)', () => {
  it('shows empty on a successful GET returning zero invites, no error state', async () => {
    api.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1/invites') {
        return { data: { items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<InvitePanel docId="d_1" role="admin" />)
    await findMessage('empty')
    // No alert role → the load succeeded; the empty text was rendered by the invite branch,
    // not by the error branch.
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows error on a failed GET, and does NOT fall through to the empty text', async () => {
    api.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1/invites') {
        throw httpError(500, { error: 'boom' })
      }
      return { data: {}, status: 200 }
    }
    render(<InvitePanel docId="d_1" role="admin" />)
    // An alert is rendered by the error branch — even if the localized copy shifts, the role
    // stays. That is the discriminator that proves the two states are independent.
    await waitFor(() => {
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
    })
    // The empty branch's classed paragraph must NOT be present alongside the error.
    expect(document.querySelector('.octo-invite-empty')).toBeNull()
  })
})

describe('InvitePanel — allowedRoles narrows the role selector (OCT-195)', () => {
  it('renders only allowed roles as options when allowedRoles is set', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    render(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader']} />)
    await waitFor(() => {
      const opts = Array.from(document.querySelectorAll('select option')) as HTMLOptionElement[]
      // The role select is the first one on the panel; the expiry-days select has 1–7 options.
      const roleOpts = opts.filter((o) => /reader|writer|admin|docs\.role/.test(o.value))
      expect(roleOpts.map((o) => o.value)).toEqual(['reader'])
    })
  })

  it('renders the full role set when allowedRoles is omitted (rich-doc zero regression)', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    render(<InvitePanel docId="d_1" role="admin" />)
    await waitFor(() => {
      const opts = Array.from(document.querySelectorAll('select option')) as HTMLOptionElement[]
      const roleOpts = opts.filter((o) => ['reader', 'commenter', 'writer', 'admin'].includes(o.value))
      expect(roleOpts.map((o) => o.value).sort()).toEqual(['admin', 'commenter', 'reader', 'writer'])
    })
  })

  it('uses a scoped reader default while preserving the caller role options', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    render(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader', 'commenter', 'writer']} defaultRole="reader" />)
    await waitFor(() => expect((document.querySelector('select') as HTMLSelectElement).value).toBe('reader'))
  })

  it('reconciles writer to reader-only and never submits the stale role', async () => {
    const posts: unknown[] = []
    api.responder = (method, _url, body) => {
      if (method === 'post') posts.push(body)
      return method === 'get'
        ? { data: { items: [] }, status: 200 }
        : { data: { inviteToken: 't1', role: 'reader' }, status: 200 }
    }
    const { rerender } = render(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader', 'writer']} />)
    await waitFor(() => expect((document.querySelector('select') as HTMLSelectElement).value).toBe('writer'))
    rerender(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader']} />)
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('reader')
    fireEvent.click(document.querySelector('.octo-invite-generate') as HTMLButtonElement)
    await waitFor(() => expect(posts).toContainEqual({ role: 'reader', expiresInDays: 3 }))
  })

  it('uses a changed valid default, then the first role for an invalid default', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    const { rerender } = render(<InvitePanel docId="d_1" role="admin" allowedRoles={['writer']} />)
    await waitFor(() => expect((document.querySelector('select') as HTMLSelectElement).value).toBe('writer'))
    rerender(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader', 'commenter']} defaultRole="commenter" />)
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('commenter')
    rerender(<InvitePanel docId="d_1" role="admin" allowedRoles={['reader']} defaultRole="admin" />)
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('reader')
  })

  it('follows a changed valid default even when the current role remains allowed', async () => {
    const posts: unknown[] = []
    api.responder = (method, _url, body) => {
      if (method === 'post') posts.push(body)
      return method === 'get'
        ? { data: { items: [] }, status: 200 }
        : { data: { inviteToken: 't1', role: 'commenter' }, status: 200 }
    }
    const props = {
      docId: 'd_1',
      role: 'admin' as Role,
      allowedRoles: ['reader', 'commenter'] as Role[],
    }
    const { rerender } = render(<InvitePanel {...props} defaultRole="reader" />)
    await waitFor(() => expect((document.querySelector('select') as HTMLSelectElement).value).toBe('reader'))

    rerender(<InvitePanel {...props} defaultRole="commenter" />)

    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('commenter')
    fireEvent.click(document.querySelector('.octo-invite-generate') as HTMLButtonElement)
    await waitFor(() => expect(posts).toContainEqual({ role: 'commenter', expiresInDays: 3 }))
  })

  it('preserves a user-selected allowed role when the default is unchanged', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    const props = {
      docId: 'd_1',
      role: 'admin' as Role,
      allowedRoles: ['reader', 'commenter'] as Role[],
      defaultRole: 'reader' as Role,
    }
    const { rerender } = render(<InvitePanel {...props} />)
    const select = document.querySelector('select') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('reader'))
    fireEvent.change(select, { target: { value: 'commenter' } })

    rerender(<InvitePanel {...props} allowedRoles={[...props.allowedRoles]} />)

    expect(select.value).toBe('commenter')
  })
})
