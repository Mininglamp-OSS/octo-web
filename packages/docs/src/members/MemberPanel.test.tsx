import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
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

  it('keeps the owner row rendering a disabled admin select on the rich surface (zero change)', async () => {
    // Guards rich-side parity after the locked-row fix: on rich the grantable set is the full
    // ROLES (incl. admin), so the owner's synthetic 'admin' role DOES have a matching option and
    // must still render as a disabled select whose value is 'admin' (unlike html, which drops it).
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_named" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    const ownerRow = screen
      .getByText('docs.member.ownerBadge')
      .closest('.octo-member-row') as HTMLElement
    const ownerSelect = ownerRow.querySelector('select') as HTMLSelectElement
    expect(ownerSelect).toBeTruthy()
    expect(ownerSelect.disabled).toBe(true)
    // On rich the owner's effective role ('writer' here — a real grant; 'admin' when synthesized)
    // is in the grantable ROLES set, so it renders a disabled select showing that real role
    // (rich behavior is unchanged by the html locked-row fix).
    expect(ownerSelect.value).toBe('writer')
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

describe('MemberPanel — bot section + AI tag + frozen order (PR C #3/#4)', () => {
  // Members list (grants) comes from the /members API; bot classification comes from the space
  // directory (spaceMembers isBot flag + /robot/space_bots). Helper to wire both together.
  function wireMembers(members: Array<{ uid: string; role: string; source?: string }>): void {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        return {
          data: {
            items: members.map((m) => ({
              uid: m.uid,
              role: m.role,
              source: m.source ?? 'direct',
              grantedBy: 'u_admin',
            })),
          },
          status: 200,
        }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (url.startsWith('/robot/space_bots')) return { data: [], status: 200 }
      return { data: {}, status: 200 }
    }
  }

  function currentSection(): HTMLElement {
    return screen.getByText('docs.member.currentMembers').closest('.octo-member-section')! as HTMLElement
  }
  function currentSectionRows(): string[] {
    return Array.from(currentSection().querySelectorAll('.octo-member-row .octo-uid')).map((el) => el.textContent ?? '')
  }

  it('groups bots below all humans, default-collapsed (hidden until expanded)', async () => {
    // u_bot is a bot (space-member isBot flag); u_human is a person.
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' }, { uid: 'u_bot', name: 'Bot One', isBot: true })
    wireMembers([
      { uid: 'u_human', role: 'writer' },
      { uid: 'u_bot', role: 'writer' },
    ])
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Human One'))).toBe(true))
    // Collapsed by default: the bot row is NOT rendered, and the expander (showBots) is present.
    expect(currentSectionRows().some((r) => r.includes('Bot One'))).toBe(false)
    const toggle = within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Expand → bot row appears, and it sits AFTER the human row.
    fireEvent.click(toggle)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Bot One'))).toBe(true))
    const rows = currentSectionRows()
    expect(rows.findIndex((r) => r.includes('Human One'))).toBeLessThan(
      rows.findIndex((r) => r.includes('Bot One')),
    )
    // aria-expanded flips to true after expanding.
    expect(within(currentSection()).getByText('docs.member.hideBots').closest('button')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('tags bot rows with the AI badge; human rows have none', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' }, { uid: 'u_bot', name: 'Bot One', isBot: true })
    wireMembers([
      { uid: 'u_human', role: 'writer' },
      { uid: 'u_bot', role: 'writer' },
    ])
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Human One'))).toBe(true))
    fireEvent.click(within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Bot One'))).toBe(true))
    const section = currentSection()
    const botRow = Array.from(section.querySelectorAll('.octo-member-row')).find((r) =>
      (r.textContent ?? '').includes('Bot One'),
    ) as HTMLElement
    const humanRow = Array.from(section.querySelectorAll('.octo-member-row')).find((r) =>
      (r.textContent ?? '').includes('Human One'),
    ) as HTMLElement
    expect(botRow.querySelector('.octo-member-picker-badge')).toBeTruthy()
    expect(botRow.textContent).toContain('docs.member.aiTag')
    expect(humanRow.querySelector('.octo-member-picker-badge')).toBeNull()
  })

  it('pins a bot OWNER at the top and never folds it into the bot section', async () => {
    // The owner itself is a bot; it must still be pinned first and stay out of the fold.
    wk.spaceMembers.push({ uid: 'u_owner', name: 'Bot Owner', isBot: true }, { uid: 'u_human', name: 'Human One' })
    wireMembers([{ uid: 'u_human', role: 'writer' }])
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    const section = currentSection()
    const ownerRow = screen.getByText('docs.member.ownerBadge').closest('.octo-member-row') as HTMLElement
    // Owner row is the FIRST row in the section.
    const firstRow = section.querySelector('.octo-member-row')
    expect(firstRow).toBe(ownerRow)
    // A single (bot) owner + one human, zero foldable bots → no expander at all.
    expect(within(section).queryByText('docs.member.showBots')).toBeNull()
  })

  it('fail-soft: empty bot directory renders every row tiled, no AI tag, no expander', async () => {
    // No isBot flags, no space_bots rows → botUids empty → all rows are humans.
    wk.spaceMembers.push({ uid: 'u_a', name: 'Aaa' }, { uid: 'u_b', name: 'Bbb' })
    wireMembers([
      { uid: 'u_a', role: 'writer' },
      { uid: 'u_b', role: 'reader' },
    ])
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Aaa'))).toBe(true))
    const section = currentSection()
    expect(within(section).queryByText('docs.member.showBots')).toBeNull()
    expect(within(section).queryByText('docs.member.hideBots')).toBeNull()
    expect(section.querySelector('.octo-member-picker-badge')).toBeNull()
  })

  it('does not render a bot expander when there are zero bots', async () => {
    wk.spaceMembers.push({ uid: 'u_a', name: 'Aaa' })
    wireMembers([{ uid: 'u_a', role: 'writer' }])
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('Aaa'))).toBe(true))
    expect(within(currentSection()).queryByText('docs.member.showBots')).toBeNull()
  })

  it('freezes member order across a role change until the panel is reopened (need #4)', async () => {
    // u_a starts as commenter, u_z as reader → u_a sorts ABOVE u_z. We then promote u_z to admin;
    // a raw re-sort would jump u_z to the TOP (admin rank), so the frozen snapshot is the only
    // thing that can keep u_a above u_z (fail-before: without the snapshot u_z leads).
    let zRole = 'reader'
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        return {
          data: {
            items: [
              { uid: 'u_a', role: 'commenter', source: 'direct', grantedBy: 'u_admin' },
              { uid: 'u_z', role: zRole, source: 'direct', grantedBy: 'u_admin' },
            ],
          },
          status: 200,
        }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (method === 'put' && url.endsWith('/members')) {
        zRole = 'admin' // upsert reflected on the next refresh — would out-rank u_a under raw sort
        return { data: {}, status: 200 }
      }
      if (url.startsWith('/robot/space_bots')) return { data: [], status: 200 }
      return { data: {}, status: 200 }
    }
    const { unmount } = render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('u_z'))).toBe(true))
    // Initial frozen order: u_a (commenter) before u_z (reader).
    let rows = currentSectionRows()
    expect(rows.findIndex((r) => r.includes('u_a'))).toBeLessThan(rows.findIndex((r) => r.includes('u_z')))
    // Promote u_z reader → admin via its row select (scoped to the current section).
    const zRow = Array.from(currentSection().querySelectorAll('.octo-member-row')).find((r) =>
      (r.textContent ?? '').includes('u_z'),
    ) as HTMLElement
    fireEvent.change(zRow.querySelector('select') as HTMLSelectElement, { target: { value: 'admin' } })
    // After the refresh u_z's role updates to admin, but its POSITION is frozen (still after u_a).
    await waitFor(() => {
      const s = (Array.from(currentSection().querySelectorAll('.octo-member-row')).find((r) =>
        (r.textContent ?? '').includes('u_z'),
      ) as HTMLElement).querySelector('select') as HTMLSelectElement
      expect(s.value).toBe('admin')
    })
    rows = currentSectionRows()
    expect(rows.findIndex((r) => r.includes('u_a'))).toBeLessThan(rows.findIndex((r) => r.includes('u_z')))

    // Reopen (unmount + remount): the fresh mount re-seeds the snapshot from the NEW roles — u_z is
    // now admin, so it out-ranks u_a and leads. This proves reopen recomputes order from scratch.
    unmount()
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('u_z'))).toBe(true))
    const reopened = currentSectionRows()
    expect(reopened.findIndex((r) => r.includes('u_z'))).toBeLessThan(reopened.findIndex((r) => r.includes('u_a')))
  })

  it('appends a newly added member to the end of the frozen order (need #4)', async () => {
    let includeNew = false
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        const items = [
          { uid: 'u_a', role: 'writer', source: 'direct', grantedBy: 'u_admin' },
          { uid: 'u_b', role: 'reader', source: 'direct', grantedBy: 'u_admin' },
        ]
        // A new admin member arrives on refresh; by raw sort it would jump to the TOP (admin rank),
        // but the frozen snapshot must append it at the END.
        if (includeNew) items.push({ uid: 'u_new', role: 'admin', source: 'direct', grantedBy: 'u_admin' })
        return { data: { items }, status: 200 }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (method === 'put' && url.endsWith('/members')) {
        includeNew = true
        return { data: {}, status: 200 }
      }
      if (url.startsWith('/robot/space_bots')) return { data: [], status: 200 }
      return { data: {}, status: 200 }
    }
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('u_b'))).toBe(true))
    // Trigger a refresh that surfaces the new admin member (change u_b's role to force the PUT+refresh).
    const bRow = Array.from(currentSection().querySelectorAll('.octo-member-row')).find((r) =>
      (r.textContent ?? '').includes('u_b'),
    ) as HTMLElement
    fireEvent.change(bRow.querySelector('select') as HTMLSelectElement, { target: { value: 'commenter' } })
    await waitFor(() => expect(currentSectionRows().some((r) => r.includes('u_new'))).toBe(true))
    const rows = currentSectionRows()
    // Despite being an admin (top rank), the new member is appended LAST (after u_a and u_b).
    expect(rows.findIndex((r) => r.includes('u_new'))).toBeGreaterThan(rows.findIndex((r) => r.includes('u_a')))
    expect(rows.findIndex((r) => r.includes('u_new'))).toBeGreaterThan(rows.findIndex((r) => r.includes('u_b')))
  })
})

describe('MemberPanel — bots nested under their creator (PR C bot-nesting change)', () => {
  // space_bots now carries creator_uid; the panel nests each bot under its creator row (per-creator
  // default-collapsed expander) and drops ownerless bots into a single bottom fold.
  function wireMembers(
    members: Array<{ uid: string; role: string; source?: string }>,
    bots: Array<{ uid: string; name?: string; creator_uid?: string }>,
  ): void {
    // The list only renders actual doc-member grants; a bot must therefore be BOTH a grant row AND
    // a space_bots entry (its creator_uid) to show. Auto-grant each bot as a member (reader).
    const memberItems = [
      ...members.map((m) => ({ uid: m.uid, role: m.role, source: m.source ?? 'direct', grantedBy: 'u_admin' })),
      ...bots.map((b) => ({ uid: b.uid, role: 'reader', source: 'direct', grantedBy: 'u_admin' })),
    ]
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/members')) {
        return { data: { items: memberItems }, status: 200 }
      }
      if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
      if (url.startsWith('/robot/space_bots')) return { data: bots, status: 200 }
      return { data: {}, status: 200 }
    }
  }
  function currentSection(): HTMLElement {
    return screen.getByText('docs.member.currentMembers').closest('.octo-member-section')! as HTMLElement
  }
  function rowFor(text: string): HTMLElement {
    return Array.from(currentSection().querySelectorAll('.octo-member-row')).find((r) =>
      (r.textContent ?? '').includes(text),
    ) as HTMLElement
  }
  function visibleUids(): string[] {
    return Array.from(currentSection().querySelectorAll('.octo-member-row .octo-uid')).map((el) => el.textContent ?? '')
  }

  it('renders a bot directly below its creator row, collapsed by default (new #1/#2)', async () => {
    // u_human owns Bot One (creator_uid = u_human). Bot must nest under u_human, hidden until the
    // creator's own expander is clicked.
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_1', name: 'Bot One', creator_uid: 'u_human' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    // Collapsed by default: Bot One not visible; a per-creator expander sits right after the human.
    expect(visibleUids().some((r) => r.includes('Bot One'))).toBe(false)
    const humanRow = rowFor('Human One')
    const expander = humanRow.parentElement!.querySelector('.octo-member-picker-expand') as HTMLButtonElement
    expect(expander).toBeTruthy()
    expect(expander.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expander)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Bot One'))).toBe(true))
    // The bot renders inside the SAME wrapper as its creator (nested, not the bottom fold).
    expect((humanRow.parentElement!.textContent ?? '').includes('Bot One')).toBe(true)
  })

  it('gives each creator an INDEPENDENT expander (expanding A leaves B collapsed)', async () => {
    wk.spaceMembers.push({ uid: 'u_a', name: 'Alpha' }, { uid: 'u_b', name: 'Beta' })
    wireMembers(
      [
        { uid: 'u_a', role: 'writer' },
        { uid: 'u_b', role: 'writer' },
      ],
      [
        { uid: 'b_a', name: 'BotA', creator_uid: 'u_a' },
        { uid: 'b_b', name: 'BotB', creator_uid: 'u_b' },
      ],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Alpha'))).toBe(true))
    const expanders = Array.from(currentSection().querySelectorAll('.octo-member-picker-expand')) as HTMLButtonElement[]
    expect(expanders.length).toBe(2)
    const alphaExpander = rowFor('Alpha').parentElement!.querySelector('.octo-member-picker-expand') as HTMLButtonElement
    fireEvent.click(alphaExpander)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('BotA'))).toBe(true))
    // Beta's bot is STILL hidden — independent expansion state.
    expect(visibleUids().some((r) => r.includes('BotB'))).toBe(false)
  })

  it('drops a bot whose creator is not a member into the bottom ownerless fold (new #3)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_orphan', name: 'Orphan Bot', creator_uid: 'u_stranger' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    // The human has no bots → no expander in its wrapper.
    expect(rowFor('Human One').parentElement!.querySelector('.octo-member-picker-expand')).toBeNull()
    const expander = within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement
    fireEvent.click(expander)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Orphan Bot'))).toBe(true))
  })

  it('does not render the bottom ownerless fold when there are zero orphan bots (new #4)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_1', name: 'Bot One', creator_uid: 'u_human' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    const expanders = Array.from(currentSection().querySelectorAll('.octo-member-picker-expand')) as HTMLButtonElement[]
    expect(expanders.length).toBe(1)
    // That single expander lives inside the creator's wrapper (nested), not a bottom sibling.
    expect(rowFor('Human One').parentElement!.contains(expanders[0])).toBe(true)
  })

  it('renders no expander for a creator that owns zero bots (new #5)', async () => {
    wk.spaceMembers.push({ uid: 'u_a', name: 'Alpha' }, { uid: 'u_b', name: 'Beta' })
    wireMembers(
      [
        { uid: 'u_a', role: 'writer' },
        { uid: 'u_b', role: 'writer' },
      ],
      [{ uid: 'b_a', name: 'BotA', creator_uid: 'u_a' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Beta'))).toBe(true))
    expect(rowFor('Alpha').parentElement!.querySelector('.octo-member-picker-expand')).toBeTruthy()
    expect(rowFor('Beta').parentElement!.querySelector('.octo-member-picker-expand')).toBeNull()
  })

  it('lets the OWNER be a bot creator (owner keeps pinned + carries its dropdown) (new #6)', async () => {
    wk.spaceMembers.push({ uid: 'u_owner', name: 'Owner Person' }, { uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_owned', name: 'Owner Bot', creator_uid: 'u_owner' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(screen.getByText('docs.member.ownerBadge')).toBeTruthy())
    const ownerRow = screen.getByText('docs.member.ownerBadge').closest('.octo-member-row') as HTMLElement
    // Owner is the FIRST row.
    expect(currentSection().querySelector('.octo-member-row')).toBe(ownerRow)
    const ownerExpander = ownerRow.parentElement!.querySelector('.octo-member-picker-expand') as HTMLButtonElement
    expect(ownerExpander).toBeTruthy()
    fireEvent.click(ownerExpander)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Owner Bot'))).toBe(true))
  })

  it('tags EVERY bot row (nested + orphan) with the AI badge; humans have none (new #7)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [
        { uid: 'b_nested', name: 'Nested Bot', creator_uid: 'u_human' },
        { uid: 'b_orphan', name: 'Orphan Bot', creator_uid: 'u_stranger' },
      ],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    fireEvent.click(rowFor('Human One').parentElement!.querySelector('.octo-member-picker-expand') as HTMLButtonElement)
    fireEvent.click(within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Orphan Bot'))).toBe(true))
    expect(rowFor('Nested Bot').querySelector('.octo-member-picker-badge')).toBeTruthy()
    expect(rowFor('Orphan Bot').querySelector('.octo-member-picker-badge')).toBeTruthy()
    expect(rowFor('Human One').querySelector('.octo-member-picker-badge')).toBeNull()
  })

  it('fail-soft: no bot directory → all rows tiled, no AI tag, no expander (new #8)', async () => {
    wk.spaceMembers.push({ uid: 'u_a', name: 'Aaa' }, { uid: 'u_b', name: 'Bbb' })
    wireMembers(
      [
        { uid: 'u_a', role: 'writer' },
        { uid: 'u_b', role: 'reader' },
      ],
      [],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Aaa'))).toBe(true))
    expect(currentSection().querySelector('.octo-member-picker-expand')).toBeNull()
    expect(currentSection().querySelector('.octo-member-picker-badge')).toBeNull()
  })

  it('empty botCreators (bots but no creator_uid) → all bots land in the bottom fold (new #9)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [
        { uid: 'b_1', name: 'Bot One' },
        { uid: 'b_2', name: 'Bot Two' },
      ],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    expect(rowFor('Human One').parentElement!.querySelector('.octo-member-picker-expand')).toBeNull()
    fireEvent.click(within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Bot One'))).toBe(true))
    expect(visibleUids().some((r) => r.includes('Bot Two'))).toBe(true)
  })

  it('indents a bot revealed under its creator (octo-member-row--nested); creator + owner are not indented', async () => {
    wk.spaceMembers.push({ uid: 'u_owner', name: 'Owner Person' }, { uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_1', name: 'Bot One', creator_uid: 'u_human' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    fireEvent.click(rowFor('Human One').parentElement!.querySelector('.octo-member-picker-expand') as HTMLButtonElement)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Bot One'))).toBe(true))
    // The revealed bot row carries the nested modifier (indented under its creator)…
    expect(rowFor('Bot One').classList.contains('octo-member-row--nested')).toBe(true)
    // …while the creator row and the owner row (both top-level) do NOT.
    expect(rowFor('Human One').classList.contains('octo-member-row--nested')).toBe(false)
    const ownerRow = screen.getByText('docs.member.ownerBadge').closest('.octo-member-row') as HTMLElement
    expect(ownerRow.classList.contains('octo-member-row--nested')).toBe(false)
  })

  it('indents orphan bots revealed in the bottom fold (octo-member-row--nested)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Human One' })
    wireMembers(
      [{ uid: 'u_human', role: 'writer' }],
      [{ uid: 'b_orphan', name: 'Orphan Bot', creator_uid: 'u_stranger' }],
    )
    render(<MemberPanel docId="d_1" role="admin" space="s_1" ownerId="u_owner" />)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Human One'))).toBe(true))
    fireEvent.click(within(currentSection()).getByText('docs.member.showBots').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(visibleUids().some((r) => r.includes('Orphan Bot'))).toBe(true))
    expect(rowFor('Orphan Bot').classList.contains('octo-member-row--nested')).toBe(true)
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
