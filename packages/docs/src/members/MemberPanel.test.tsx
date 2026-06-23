import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { clearMemberNameCache } from './memberNames.ts'
import { MemberPanel } from './MemberPanel.tsx'

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  clearMemberNameCache()
  wk = createMockWKApp()
  setWKApp(wk)
  // Route the panel's REST: members list + invite list (InvitePanel) both go through apiClient.
  wk.apiClient.responder = (method, url) => {
    if (method === 'get' && url.endsWith('/members')) {
      return {
        data: {
          items: [
            { uid: 'u_named', role: 'writer', source: 'direct', grantedBy: 'u_admin' },
            { uid: 'u_unknown', role: 'reader', source: 'invite', grantedBy: 'u_admin' },
          ],
        },
        status: 200,
      }
    }
    if (method === 'get' && url.endsWith('/invites')) {
      return { data: { items: [] }, status: 200 }
    }
    return { data: {}, status: 200 }
  }
})

afterEach(() => cleanup())

describe('MemberPanel — display names (#7)', () => {
  it('renders the member NAME from the space map, falling back to uid', async () => {
    wk.spaceMembers.push({ uid: 'u_named', name: 'Grace Hopper' })
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)

    // The named member shows the display name (it appears both in the picker roster and the
    // resolved member list, so there may be more than one occurrence)…
    await waitFor(() => expect(screen.getAllByText(/Grace Hopper/).length).toBeGreaterThan(0))
    // …and a uid with no space-member name falls back to the raw uid (never blank).
    expect(screen.getByText(/u_unknown/)).toBeTruthy()
  })

  it('places the "Add member" and "Invite" sections at the top', async () => {
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.member.addMember')).toBeTruthy())
    expect(screen.getByText('docs.member.inviteTitle')).toBeTruthy()
  })

  it('renders nothing for a non-admin role', () => {
    const { container } = render(<MemberPanel docId="d_1" role="writer" space="s_1" />)
    expect(container.firstChild).toBeNull()
  })
})
