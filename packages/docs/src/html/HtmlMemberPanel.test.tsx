import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Mock every child component / data hook so this file only asserts the outer section order and
// gate composition. Each stub carries a stable heading (or testid) so we can locate it without
// pulling in real network / share/invite/access-request wiring.
vi.mock('./htmlGrantsApi.ts', () => ({
  listGrants: vi.fn(async () => []),
  addGrant: vi.fn(async () => {}),
  removeGrant: vi.fn(async () => {}),
}))

vi.mock('../share/ShareScopePanel.tsx', () => ({
  // Real ShareScopePanel renders an h4 with `docs.share.title` — mirror that heading exactly so
  // the ordered heading assertion below observes the same DOM shape as production.
  ShareScopePanel: () => <h4 data-testid="share-scope-stub">docs.share.title</h4>,
}))

vi.mock('../invite/InvitePanel.tsx', () => ({
  InvitePanel: () => <div data-testid="invite-panel-stub" />,
}))

vi.mock('../access-request/PendingRequests.tsx', () => ({
  PendingRequests: () => <div data-testid="pending-requests-stub" />,
}))

vi.mock('../access-request/useAccessRequests.ts', () => ({
  useAccessRequests: () => ({
    requests: [],
    loading: false,
    error: null,
    approve: vi.fn(),
    deny: vi.fn(),
    refetch: vi.fn(),
  }),
}))

vi.mock('../members/MemberPicker.tsx', () => ({
  MemberPicker: () => <div data-testid="member-picker-stub" />,
}))

import { HtmlMemberPanel } from './HtmlMemberPanel.tsx'
import * as htmlGrantsApi from './htmlGrantsApi.ts'

// Ordered heading text (h3 + h4), so we can compare against the rich-doc MemberPanel section
// order literally. Explicit sequence beats a snapshot: i18n text may shift, but the ordering
// contract is exactly what OCT-195 requires.
function headingTexts(): string[] {
  return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '')
}

beforeEach(() => {
  setWKApp(createMockWKApp())
})

afterEach(() => {
  cleanup()
})

describe('HtmlMemberPanel — section order (OCT-195)', () => {
  it('admin + author: renders all 5 slots in rich-doc order', async () => {
    render(
      <HtmlMemberPanel
        slug="s1"
        docId="d1"
        role="admin"
        isAuthor={true}
      />,
    )
    await waitFor(() => expect(screen.getByText('docs.member.addMember')).toBeTruthy())
    expect(headingTexts()).toEqual([
      'docs.member.manage',
      'docs.share.title',
      'docs.member.addMember',
      'docs.member.inviteTitle',
      'docs.member.currentMembers',
    ])
    // Slot 4 (PendingRequests) has no heading of its own; assert its stub is present so we don't
    // silently drop it when refactoring.
    expect(screen.getByTestId('pending-requests-stub')).toBeTruthy()
  })

  it('admin only (not author): backend slots render, author slots hidden', async () => {
    render(
      <HtmlMemberPanel
        slug="s1"
        docId="d1"
        role="admin"
        isAuthor={false}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('share-scope-stub')).toBeTruthy())
    expect(headingTexts()).toEqual([
      'docs.member.manage',
      'docs.share.title',
      'docs.member.inviteTitle',
    ])
    expect(screen.queryByText('docs.member.addMember')).toBeNull()
    expect(screen.queryByText('docs.member.currentMembers')).toBeNull()
    expect(screen.getByTestId('pending-requests-stub')).toBeTruthy()
  })

  it('author only (reader on backend): author slots render, backend slots hidden', async () => {
    render(
      <HtmlMemberPanel
        slug="s1"
        docId="d1"
        role="reader"
        isAuthor={true}
      />,
    )
    await waitFor(() => expect(screen.getByText('docs.member.addMember')).toBeTruthy())
    expect(headingTexts()).toEqual([
      'docs.member.manage',
      'docs.member.addMember',
      'docs.member.currentMembers',
    ])
    expect(screen.queryByTestId('share-scope-stub')).toBeNull()
    expect(screen.queryByText('docs.member.inviteTitle')).toBeNull()
    expect(screen.queryByTestId('pending-requests-stub')).toBeNull()
  })

  it('role=null + not author: shows manage title + loading placeholder only', async () => {
    render(
      <HtmlMemberPanel
        slug="s1"
        docId="d1"
        role={null}
        isAuthor={false}
      />,
    )
    // Only the top manage heading; backend slots stay hidden while role resolves and author
    // slots are gated off entirely.
    await waitFor(() => expect(screen.getByText('docs.member.loading')).toBeTruthy())
    expect(headingTexts()).toEqual(['docs.member.manage'])
    expect(screen.queryByTestId('share-scope-stub')).toBeNull()
    expect(screen.queryByText('docs.member.inviteTitle')).toBeNull()
    expect(screen.queryByTestId('pending-requests-stub')).toBeNull()
    expect(screen.queryByText('docs.member.addMember')).toBeNull()
    expect(screen.queryByText('docs.member.currentMembers')).toBeNull()
  })
})

// Current-members list is now the shared CurrentMembersList (rich/html parity). These tests exercise
// the real list behavior: role ordering, role-change → PUT /grants + refresh, error path, the
// locked owner/creator row, and the reader/commenter/writer role surface (admin never grantable).
describe('HtmlMemberPanel — shared current-members list (author gate)', () => {
  const listGrants = vi.mocked(htmlGrantsApi.listGrants)
  const addGrant = vi.mocked(htmlGrantsApi.addGrant)

  beforeEach(() => {
    listGrants.mockReset()
    addGrant.mockReset().mockResolvedValue(undefined)
  })

  function memberRowUids(): string[] {
    return Array.from(
      document.querySelectorAll('.octo-member-section .octo-member-row .octo-uid'),
    ).map((el) => el.textContent ?? '')
  }

  it('orders members by role: owner pinned, admin before reader (sort.ts parity)', async () => {
    // Backend returns rows out of role order; the shared list must re-sort them. admin appears here
    // only to prove ordering (a stray admin grant); owner/creator is pinned above all.
    listGrants.mockResolvedValue([
      { uid: 'u_reader', role: 'reader', source: 'direct' },
      { uid: 'u_admin', role: 'admin', source: 'direct' },
      { uid: 'u_writer', role: 'writer', source: 'direct' },
    ])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    const rows = memberRowUids()
    const idx = (u: string) => rows.findIndex((r) => r.includes(u))
    expect(idx('u_owner')).toBe(0) // owner/creator pinned first
    expect(idx('u_admin')).toBeLessThan(idx('u_writer'))
    expect(idx('u_writer')).toBeLessThan(idx('u_reader')) // admin < writer < reader
  })

  it('changing a member role issues PUT /grants with the new role and refreshes', async () => {
    listGrants
      .mockResolvedValueOnce([{ uid: 'u_reader', role: 'reader', source: 'direct' }])
      // refresh after the change: reflect the upsert so the list is consistent.
      .mockResolvedValueOnce([{ uid: 'u_reader', role: 'writer', source: 'direct' }])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText(/u_reader/)).toBeTruthy())
    const selects = Array.from(
      document.querySelectorAll('.octo-member-section select'),
    ) as HTMLSelectElement[]
    const memberSelect = selects.find((s) => !s.disabled)!
    fireEvent.change(memberSelect, { target: { value: 'writer' } })
    await waitFor(() => expect(addGrant).toHaveBeenCalledWith('s1', 'u_reader', 'writer'))
    // refresh() called again after the change → listGrants hit a second time.
    await waitFor(() => expect(listGrants).toHaveBeenCalledTimes(2))
  })

  it('shows the role error text when the role change PUT fails', async () => {
    listGrants.mockResolvedValue([{ uid: 'u_reader', role: 'reader', source: 'direct' }])
    addGrant.mockRejectedValue(new Error('boom'))
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText(/u_reader/)).toBeTruthy())
    const memberSelect = (Array.from(
      document.querySelectorAll('.octo-member-section select'),
    ) as HTMLSelectElement[]).find((s) => !s.disabled)!
    fireEvent.change(memberSelect, { target: { value: 'commenter' } })
    await waitFor(() => expect(screen.getByText('docs.member.errorRole')).toBeTruthy())
  })

  it('locks the creator/owner row: no remove button, no editable role select', async () => {
    listGrants.mockResolvedValue([{ uid: 'u_reader', role: 'reader', source: 'direct' }])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    // Exactly one removable member (u_reader) → one remove button; the owner row has none.
    expect(screen.getAllByText('docs.member.remove')).toHaveLength(1)
    // The owner row carries NO role select on the html surface (its 'author' role is not
    // grantable here, so it renders name + badge only — never a reader-looking select).
    const ownerRow = screen
      .getByText('docs.member.ownerBadge')
      .closest('.octo-member-row') as HTMLElement
    expect(ownerRow.querySelector('select')).toBeNull()
    // The one member row (u_reader) still has an enabled select.
    const selects = Array.from(
      document.querySelectorAll('.octo-member-section select'),
    ) as HTMLSelectElement[]
    expect(selects.some((s) => !s.disabled)).toBe(true)
  })

  it('offers only reader/commenter/writer on member rows — admin is never grantable', async () => {
    listGrants.mockResolvedValue([{ uid: 'u_reader', role: 'reader', source: 'direct' }])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText(/u_reader/)).toBeTruthy())
    const memberSelect = (Array.from(
      document.querySelectorAll('.octo-member-section select'),
    ) as HTMLSelectElement[]).find((s) => !s.disabled)!
    expect(Array.from(memberSelect.options).map((o) => o.value)).toEqual([
      'reader',
      'commenter',
      'writer',
    ])
    expect(Array.from(memberSelect.options).map((o) => o.value)).not.toContain('admin')
  })

  // The owner's synthetic role ('author', mapped to 'admin' for ranking) is NOT in the html
  // grantable set (reader/commenter/writer). Rendering a select there left React with no matching
  // <option>, snapping selectedIndex to 0 → the doc AUTHOR was shown as "reader" (misleading UI).
  // The owner row must carry the owner badge + name only, with NO role select and NO role text.
  it('owner row shows no role select and is not mislabeled as reader (P1)', async () => {
    listGrants.mockResolvedValue([{ uid: 'u_reader', role: 'reader', source: 'direct' }])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    const ownerRow = screen
      .getByText('docs.member.ownerBadge')
      .closest('.octo-member-row') as HTMLElement
    // No editable/inert role select on the owner row at all.
    expect(ownerRow.querySelector('select')).toBeNull()
    // And crucially it is NOT displayed as reader (the fail-before symptom) or any role text.
    expect(ownerRow.textContent).not.toContain('docs.role.reader')
    expect(ownerRow.textContent).not.toContain('docs.role.commenter')
    expect(ownerRow.textContent).not.toContain('docs.role.writer')
  })

  // Safety: a historical `admin` grant returned by the backend is NOT grantable on the html surface
  // (reader/commenter/writer). Previously it rendered a select with no admin option → shown as
  // reader, and a single change would have silently downgraded a real admin. It must render as
  // static `docs.role.admin` text with no editable select.
  it('renders a non-grantable admin grant as static text, never a downgradeable select (safety)', async () => {
    listGrants.mockResolvedValue([{ uid: 'u_admin', role: 'admin', source: 'direct' }])
    render(<HtmlMemberPanel slug="s1" docId="d1" role="reader" isAuthor={true} creatorUid="u_owner" />)
    await waitFor(() => expect(screen.getByText(/u_admin/)).toBeTruthy())
    const adminRow = screen.getByText(/u_admin/).closest('.octo-member-row') as HTMLElement
    // No editable select for a role this surface can't grant → cannot be silently downgraded.
    expect(adminRow.querySelector('select')).toBeNull()
    // The real role is shown as static text, not misrepresented as reader.
    expect(adminRow.textContent).toContain('docs.role.admin')
    expect(adminRow.textContent).not.toContain('docs.role.reader')
  })
})
