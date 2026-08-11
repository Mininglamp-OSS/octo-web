import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
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

  it('offers the four roles (incl. commenter) on member rows and keeps the owner row non-downgradeable', async () => {
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_named" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    // Member-row role dropdowns now offer commenter alongside reader/writer/admin.
    const selects = Array.from(document.querySelectorAll('.octo-member-section select')) as HTMLSelectElement[]
    const memberSelect = selects.find((s) => !s.disabled)!
    expect(Array.from(memberSelect.options).map((o) => o.value)).toEqual(['reader', 'commenter', 'writer', 'admin'])
    // The owner row's select is disabled — an admin cannot mis-downgrade the owner (fail closed).
    expect(selects.some((s) => s.disabled)).toBe(true)
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

  it('offers reader/commenter/writer on a pending access-request row (DEFAULT_REQUEST_ROLES)', async () => {
    // Access-request approve supports commenter (Backend #147); the rich-doc path passes no
    // allowedRoles, so PendingRequests falls back to DEFAULT_REQUEST_ROLES = reader|commenter|writer.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) return { data: { items: [] }, status: 200 }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (method === 'get' && url.includes('/access-requests')) {
        return { data: { items: [{ requestId: 'r_1', uid: 'u_req' }] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.approve')).toBeTruthy())
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]
    const requestSelect = selects.find(
      (s) => Array.from(s.options).map((o) => o.value).join(',') === 'reader,commenter,writer',
    )
    expect(requestSelect).toBeTruthy()
  })
  it('still sorts the current-members list by role after migrating to the shared component (#A3)', async () => {
    // Members arrive in a deliberately unsorted order; the shared CurrentMembersList must still
    // apply sort.ts ordering (owner pinned → admin → writer → commenter → reader). This locks the
    // post-migration ordering contract: fail-before if the shared list dropped the sort call.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        return {
          data: {
            items: [
              { uid: 'u_reader', role: 'reader', source: 'direct', grantedBy: 'u_admin' },
              { uid: 'u_writer', role: 'writer', source: 'direct', grantedBy: 'u_admin' },
              { uid: 'u_commenter', role: 'commenter', source: 'direct', grantedBy: 'u_admin' },
            ],
          },
          status: 200,
        }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      return { data: {}, status: 200 }
    }
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    // Scope to the Current Members section (the one carrying the owner badge); other sections
    // (the picker roster) also render `.octo-uid` rows and would pollute the ordering read.
    const currentSection = screen.getByText('docs.member.ownerBadge').closest('.octo-member-section')!
    const rows = Array.from(
      currentSection.querySelectorAll('.octo-member-row .octo-uid'),
    ).map((el) => el.textContent ?? '')
    // owner first (synthetic), then writer → commenter → reader.
    const idxOwner = rows.findIndex((r) => r.includes('u_owner'))
    const idxWriter = rows.findIndex((r) => r.includes('u_writer'))
    const idxCommenter = rows.findIndex((r) => r.includes('u_commenter'))
    const idxReader = rows.findIndex((r) => r.includes('u_reader'))
    expect(idxOwner).toBe(0)
    expect(idxWriter).toBeLessThan(idxCommenter)
    expect(idxCommenter).toBeLessThan(idxReader)
  })
})

describe('MemberPanel add: partial-failure detail survives a refresh failure (task #5)', () => {
  it('keeps the partial-failure message when the post-add refresh also fails', async () => {
    wk.spaceMembers.push({ uid: 'u_ada', name: 'Ada Lovelace' })
    let addAttempted = false
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        // The FIRST list (initial mount) succeeds; the refresh AFTER the add throws.
        if (addAttempted) throw { response: { status: 500 } }
        return { data: { items: [] }, status: 200 }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (method === 'put' && url.endsWith('/members')) {
        addAttempted = true
        throw { response: { status: 500 } } // the grant itself fails
      }
      return { data: {}, status: 200 }
    }
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    // The partial-failure (grant) message is shown, NOT the generic refresh error.
    await waitFor(() => expect(screen.getByText('docs.member.errorAddSnapshot')).toBeTruthy())
    expect(screen.queryByText('docs.member.errorRefresh')).toBeNull()
  })

  it('surfaces the refresh error only when every add succeeded but the refresh failed', async () => {
    wk.spaceMembers.push({ uid: 'u_ada', name: 'Ada Lovelace' })
    let addAttempted = false
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        if (addAttempted) throw { response: { status: 500 } }
        return { data: { items: [] }, status: 200 }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (method === 'put' && url.endsWith('/members')) {
        addAttempted = true
        return { data: {}, status: 200 } // grant succeeds
      }
      return { data: {}, status: 200 }
    }
    render(<MemberPanel docId="d_1" role="admin" space="s_1" />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(screen.getByText('docs.member.errorRefresh')).toBeTruthy())
    expect(screen.queryByText('docs.member.errorAddSnapshot')).toBeNull()
  })
})
