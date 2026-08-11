// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// The in-shell forbidden landing is the PRIMARY way a user reaches the access request, so it must
// carry the Space: without it the Bot dimension is inert (no lookup, no rows, no botUids) even
// though the shell knows the Space. RequestAccessButton is rendered for real here — the whole point
// is the prop wiring — while the collaboration seams are stubbed to force the terminal branch.
vi.mock('../collab/useCollabEditor.ts', () => ({
  useCollabEditor: () => ({
    instance: null,
    ready: false,
    role: 'reader',
    connState: 'closed',
    terminal: { kind: 'forbidden' },
  }),
}))
vi.mock('@tiptap/react', () => ({ EditorContent: () => null }))
vi.mock('../members/useMemberNames.ts', () => ({ useMemberNames: () => new Map<string, string>(), useMemberDirectory: () => ({ names: new Map<string, string>(), botUids: new Set<string>() }) }))

import { EditorShell } from './EditorShell.tsx'

let wk: ReturnType<typeof createMockWKApp>

const baseProps = {
  docId: 'd_1',
  title: 'Doc',
  space: 's_1',
  folder: 'f_1',
  doc: 'd_1',
  uid: 'u_self',
  user: { id: 'u_self', name: 'Self' },
}

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => cleanup())

describe('EditorShell — forbidden landing carries the Space into the access request', () => {
  it('loads the requester\'s owned Bots and submits them with the request', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        return { data: [{ uid: 'b_mine', name: 'My Bot' }], status: 200 }
      }
      return { data: {}, status: 201 }
    }
    render(<EditorShell {...baseProps} />)
    expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy()
    // The Bot dimension is live: scoped to the shell's Space and default-selected.
    await waitFor(() => expect(screen.getByText('My Bot')).toBeTruthy())
    const owned = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/owned_bots'))
    expect(owned).toHaveLength(1)
    expect(owned[0].url).toBe('/robot/owned_bots?space_id=s_1')

    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    expect(wk.apiClient.calls.find((c) => c.method === 'post')!.body).toEqual({ botUids: ['b_mine'] })
  })

  it('blocks the request while the Bot set is unknown instead of filing a human-only one', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) throw new Error('boom')
      return { data: {}, status: 201 }
    }
    render(<EditorShell {...baseProps} />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestBotsError')).toBeTruthy())
    const submit = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(false)
  })
})
