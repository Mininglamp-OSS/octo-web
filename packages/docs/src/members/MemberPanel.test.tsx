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

  it('renders the link share-scope section for an admin (feature #64)', async () => {
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.share.title')).toBeTruthy())
    // Both scope options are present; the default responder yields restricted, so the tier is hidden.
    expect(screen.getByText('docs.share.restricted')).toBeTruthy()
    expect(screen.getByText('docs.share.anyoneInSpace')).toBeTruthy()
  })

  it('marks the owner row with an Owner badge (#A1)', async () => {
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_named" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
  })

  it('always renders a "current members" section with the member rows (#A1/#A3)', async () => {
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_named" />)
    // The list section header is always present so the panel never looks like it only has
    // "add"+"invite" (the A1/A3 regression: rows had no home, so owner badge/pinning never showed).
    await waitFor(() => expect(screen.getByText('docs.member.currentMembers')).toBeTruthy())
    // Both members render as rows with the owner badge on the owner row.
    expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy()
  })

  it('synthesizes a pinned owner row when the owner is absent from the members API (#A1/#A3)', async () => {
    // Backend members API excludes the owner (owner lives in doc_meta, not doc_member). With an
    // ownerId that is NOT in the returned members, the panel still shows an owner row + badge.
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner_only" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    // The synthetic owner row carries no remove button (it is not a removable member grant).
    // The two real members each have a remove button → exactly 2 remove buttons, not 3.
    expect(screen.getAllByText('docs.member.remove')).toHaveLength(2)
  })

  it('shows an empty state (not a blank/invisible section) when there are no members', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) return { data: { items: [] }, status: 200 }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      return { data: {}, status: 200 }
    }
    // No ownerId here → no synthetic owner row → genuinely empty → empty state shows.
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.member.currentMembers')).toBeTruthy())
    expect(screen.getByText('docs.member.empty')).toBeTruthy()
  })
})
