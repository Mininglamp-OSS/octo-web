import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
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
