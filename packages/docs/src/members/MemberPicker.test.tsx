import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { clearMemberNameCache } from './memberNames.ts'
import { MemberPicker } from './MemberPicker.tsx'
import type { Role } from '../auth/roles.ts'

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  clearMemberNameCache()
  wk = createMockWKApp()
  setWKApp(wk)
  wk.spaceMembers.push(
    { uid: 'u_grace', name: 'Grace Hopper' },
    { uid: 'u_ada', name: 'Ada Lovelace' },
    { uid: 'u_bot', name: 'Helper Bot', isBot: true },
  )
})

afterEach(() => cleanup())

describe('MemberPicker (Problem 1)', () => {
  it('lists space members with names and an AI badge for bots', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Helper Bot')).toBeTruthy()
    // The bot row carries the AI tag.
    expect(screen.getByText('docs.member.aiTag')).toBeTruthy()
  })

  it('filters locally by name as you type', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'ada' },
    })
    expect(screen.queryByText('Grace Hopper')).toBeNull()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('marks an already-added member disabled and non-selectable', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set(['u_grace'])} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    const row = screen.getByText('Grace Hopper').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(screen.getByText('docs.member.alreadyAdded')).toBeTruthy()
  })

  it('adds the selected member with the chosen role (#A2)', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())

    // Add is disabled until at least one member is ticked.
    const addBtn = screen.getByText('docs.member.add').closest('button') as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)

    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(addBtn.disabled).toBe(false)
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'writer')
  })

  it('selects a user\'s current Space Bots by default and allows cancelling one', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/space_bots')) {
        return { data: [
          { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
          { uid: 'b_2', name: 'Review Bot', creator_uid: 'u_ada' },
        ], status: 200 }
      }
      return { data: [], status: 200 }
    }
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    fireEvent.click(screen.getByText('Review Bot'))
    fireEvent.click(screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(
      ['u_ada', 'b_1'],
      'writer',
      { humanUids: ['u_ada'], botUids: ['b_1'] },
    )
  })

  it('multi-selects several members and adds them all in one action (#A2)', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())

    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('Grace Hopper'))
    // The action label switches to the count variant once more than one is selected.
    fireEvent.click(screen.getByText('docs.member.addCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledTimes(1)
    const [uids, role] = onAdd.mock.calls[0]
    expect([...uids].sort()).toEqual(['u_ada', 'u_grace'])
    expect(role).toBe('writer')
  })

  it('toggles a selection off when clicked twice (#A2)', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const addBtn = screen.getByText('docs.member.add').closest('button') as HTMLButtonElement
    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(addBtn.disabled).toBe(false)
    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(addBtn.disabled).toBe(true)
  })

  it('preserves the four baseline roles when roles prop is omitted', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    // role dropdown options (the member rows use role="option" too, so filter to the <option>s).
    const roleOptions = options.filter((o) => o.tagName === 'OPTION')
    expect(roleOptions.map((o) => o.value)).toEqual(['reader', 'commenter', 'writer', 'admin'])
  })

  it('restricts the role dropdown to a single "reader" option when roles={[\'reader\']} (HTML doc)', async () => {
    const onAdd = vi.fn()
    render(
      <MemberPicker space="s_1" existingUids={new Set()} roles={['reader']} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const roleOptions = (screen.getAllByRole('option') as HTMLElement[]).filter(
      (o) => o.tagName === 'OPTION',
    ) as HTMLOptionElement[]
    expect(roleOptions).toHaveLength(1)
    expect(roleOptions[0].value).toBe('reader')
    // The single option is the selected role, so adds carry 'reader'.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'reader')
  })

  it('falls back to the four default roles when roles={[]} (empty is a no-op, not a foot-gun)', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} roles={[]} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const roleOptions = (screen.getAllByRole('option') as HTMLElement[]).filter(
      (o) => o.tagName === 'OPTION',
    ) as HTMLOptionElement[]
    // Dropdown is non-empty (falls back to the four defaults) instead of rendering zero options.
    expect(roleOptions.map((o) => o.value)).toEqual(['reader', 'commenter', 'writer', 'admin'])
    // add() submits a valid Role ('writer' default), never undefined.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'writer')
  })

  it('supports a scoped reader default without changing the offered roles', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} roles={['reader', 'commenter', 'writer']} defaultRole="reader" onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'reader')
  })

  it('reconciles a selected writer when rerendered with reader-only roles', async () => {
    const onAdd = vi.fn()
    const { rerender } = render(
      <MemberPicker space="s_1" existingUids={new Set()} roles={['reader', 'writer']} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    rerender(<MemberPicker space="s_1" existingUids={new Set()} roles={['reader']} onAdd={onAdd} />)
    expect((document.querySelector('.octo-member-picker-actions select') as HTMLSelectElement).value).toBe('reader')
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'reader')
  })

  it('uses a changed valid default, then the first role when the default is invalid', async () => {
    const onAdd = vi.fn()
    const { rerender } = render(
      <MemberPicker space="s_1" existingUids={new Set()} roles={['writer']} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    rerender(<MemberPicker space="s_1" existingUids={new Set()} roles={['reader', 'commenter']} defaultRole="commenter" onAdd={onAdd} />)
    expect((document.querySelector('.octo-member-picker-actions select') as HTMLSelectElement).value).toBe('commenter')
    rerender(<MemberPicker space="s_1" existingUids={new Set()} roles={['reader']} defaultRole="admin" onAdd={onAdd} />)
    expect((document.querySelector('.octo-member-picker-actions select') as HTMLSelectElement).value).toBe('reader')
  })

  it('follows a changed valid default even when the current role remains allowed', async () => {
    const onAdd = vi.fn()
    const props = {
      space: 's_1',
      existingUids: new Set<string>(),
      roles: ['reader', 'commenter'] as Role[],
      onAdd,
    }
    const { rerender } = render(<MemberPicker {...props} defaultRole="reader" />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())

    rerender(<MemberPicker {...props} defaultRole="commenter" />)

    expect((document.querySelector('.octo-member-picker-actions select') as HTMLSelectElement).value).toBe('commenter')
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'commenter')
  })

  it('preserves a user-selected allowed role when the default is unchanged', async () => {
    const onAdd = vi.fn()
    const props = {
      space: 's_1',
      existingUids: new Set<string>(),
      roles: ['reader', 'commenter'] as Role[],
      defaultRole: 'reader' as Role,
      onAdd,
    }
    const { rerender } = render(<MemberPicker {...props} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const select = document.querySelector('.octo-member-picker-actions select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'commenter' } })

    rerender(<MemberPicker {...props} roles={[...props.roles]} />)

    expect(select.value).toBe('commenter')
  })
})

// task #4: Bot search matches name/uid and surfaces the creator; a hidden creator's Bots are never
// selectable; already-existing Bots are excluded from the nested list.
describe('MemberPicker Bot search + creator attribution (task #4)', () => {
  function botResponder(bots: Array<{ uid: string; name: string; creator_uid?: string }>) {
    return (method: string, url: string) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: bots, status: 200 }
        : { data: [], status: 200 }
  }

  it('surfaces a creator row when the query matches its Bot name, showing the creator', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Search by the Bot's name — the creator row stays, other humans drop out.
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'Writer Bot' },
    })
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.queryByText('Grace Hopper')).toBeNull()
    // The Bot is shown beneath its creator with a creator attribution.
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    expect(screen.getByText('docs.member.botCreator')).toBeTruthy()
  })

  it('matches a Bot by uid too', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'bot_xyz', name: 'Nameless', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'bot_xyz' },
    })
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.queryByText('Grace Hopper')).toBeNull()
  })

  // hideUids means "omit ENTIRELY". A doc-owner Bot lives in doc_meta, so it is absent from
  // existingUids and nothing else stops it from riding along under its (visible) creator.
  it('never nests, selects or submits a hidden Bot under its visible creator', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_owner', name: 'Owner Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(
      <MemberPicker
        space="s_1"
        existingUids={new Set()}
        hideUids={new Set(['b_owner'])}
        onAdd={onAdd}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Neither nested under the creator nor offered standalone, and no expander to reveal it.
    expect(screen.queryByText('Owner Bot')).toBeNull()
    expect(screen.queryByText('docs.member.showBots')).toBeNull()
    // Selecting the creator must not pull the hidden Bot in: the label stays person-only.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(screen.queryByText('docs.member.addSnapshotCount')).toBeNull()
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    // No Bot dimension at all in the submission (the snapshot arg is only sent when Bots exist).
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'writer')
  })

  it('offers a hidden creator\'s Bot as a standalone candidate', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Owner Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(
      <MemberPicker
        space="s_1"
        existingUids={new Set()}
        hideUids={new Set(['u_ada'])}
        onAdd={onAdd}
      />,
    )
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'Owner Bot' },
    })
    expect(screen.getByText('Owner Bot')).toBeTruthy()
    expect(screen.getByText('docs.member.botCreator')).toBeTruthy()
    fireEvent.click(screen.getByText('Owner Bot'))
    // A standalone Bot counts as a Bot, not a person, in the button label.
    fireEvent.click(screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(
      ['b_1'],
      'writer',
      { humanUids: [], botUids: ['b_1'] },
    )
  })

  it('offers an existing member\'s Bot standalone with creator attribution', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Independent Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set(['u_ada'])} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Independent Bot')).toBeTruthy())
    expect(screen.getByText('docs.member.botCreator')).toBeTruthy()
    fireEvent.click(screen.getByText('Independent Bot'))
    fireEvent.click(screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(
      ['b_1'],
      'writer',
      { humanUids: [], botUids: ['b_1'] },
    )
  })

  it('does not offer a Bot whose creator is absent from the Space roster', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Orphan Bot', creator_uid: 'u_missing' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.queryByText('Orphan Bot')).toBeNull()
  })

  it('keeps an already-granted standalone Bot visible and disabled', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Granted Bot', creator_uid: 'u_missing' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set(['b_1'])} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Granted Bot')).toBeTruthy())
    const row = screen.getByText('Granted Bot').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(screen.getByText('docs.member.alreadyAdded')).toBeTruthy()
  })

  it('removes an existing Bot from nesting but keeps it visible as a disabled standalone row', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
      { uid: 'b_2', name: 'Review Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set(['b_1'])} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    // Only the not-yet-added Bot is nested; the existing one remains a disabled top-level row.
    expect(screen.getByText('Review Bot')).toBeTruthy()
    const existingRow = screen.getByText('Writer Bot').closest('button') as HTMLButtonElement
    expect(existingRow.disabled).toBe(true)
  })
})

// Boss ownership decision: the candidate roster merges the caller's OWNED agents (GET
// /robot/owned_bots) with the space members, so a bot the current user CREATED but which the
// space-member query filtered out becomes selectable. A merely friend-added bot owned by someone
// else is NOT included — ownership, not friendship, drives standalone candidacy.
describe('MemberPicker owned-agent roster (Boss ownership)', () => {
  it('merges owned agents from owned_bots and dedups by uid', async () => {
    // owned_bots returns an agent the current user created (not in spaceMembers) plus a duplicate
    // of an existing space bot (u_bot) that must NOT render twice.
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/owned_bots')
        ? {
            data: [
              { uid: 'u_ownedbot', name: 'Owned Bot' },
              { uid: 'u_bot', name: 'Helper Bot (dup)' },
            ],
            status: 200,
          }
        : { data: {}, status: 200 }
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Owned Bot')).toBeTruthy())
    // The space-member entry wins on the uid collision (its name, rendered once).
    expect(screen.getAllByText('Helper Bot')).toHaveLength(1)
    expect(screen.queryByText('Helper Bot (dup)')).toBeNull()
    // The owned agent carries the AI badge (one for u_bot, one for u_ownedbot).
    expect(screen.getAllByText('docs.member.aiTag')).toHaveLength(2)
    // It is selectable and adds by its uid.
    const addBtn = screen.getByText('docs.member.add').closest('button') as HTMLButtonElement
    fireEvent.click(screen.getByText('Owned Bot'))
    expect(addBtn.disabled).toBe(false)
  })

  it('does NOT read /robot/my_bots (friendship must not confer standalone candidacy)', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/robot/my_bots'))).toBe(false)
  })

  it('renders the space roster unchanged when owned_bots fails', async () => {
    wk.apiClient.responder = (_m, url) => {
      if (url.startsWith('/robot/owned_bots')) throw new Error('boom')
      return { data: {}, status: 200 }
    }
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Helper Bot')).toBeTruthy()
  })
})

// P1: when existingUids / the offered-Bot set changes on rerender, stale selected Bots must be
// pruned too — a Bot that became existing, or whose creator became hidden/existing/unlisted, must
// never survive into the submitted snapshot.
describe('MemberPicker prunes stale selected Bots on rerender (P1)', () => {
  function botResponder(bots: Array<{ uid: string; name: string; creator_uid?: string }>) {
    return (method: string, url: string) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: bots, status: 200 }
        : { data: [], status: 200 }
  }

  it('drops a selected Bot that became existing before submit', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
      { uid: 'b_2', name: 'Review Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    const { rerender } = render(
      <MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    // Both Bots default-selected. Now b_1 gets added elsewhere → becomes existing.
    rerender(<MemberPicker space="s_1" existingUids={new Set(['b_1'])} onAdd={onAdd} />)
    fireEvent.click(
      screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement,
    )
    // b_1 must NOT be resubmitted; only the still-valid b_2 rides along.
    expect(onAdd).toHaveBeenCalledWith(
      ['u_ada', 'b_2'],
      'writer',
      { humanUids: ['u_ada'], botUids: ['b_2'] },
    )
  })

  it('drops a selected human AND their Bot when they become hidden (self / owner)', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    const { rerender } = render(
      <MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Select Ada (auto-selects b_1) then also keep Grace so a human survives after Ada is hidden.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('Grace Hopper'))
    // Now hide u_ada (e.g. resolved as owner/self) — her row, her Bot, AND her selected-human entry
    // must all drop out so a hidden uid can never ride along in the submitted snapshot.
    rerender(
      <MemberPicker
        space="s_1"
        existingUids={new Set()}
        hideUids={new Set(['u_ada'])}
        onAdd={onAdd}
      />,
    )
    const addBtn = document.querySelector(
      '.octo-member-picker-actions .octo-doc-primary-btn',
    ) as HTMLButtonElement
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledTimes(1)
    const call = onAdd.mock.calls[0]
    const submittedUids = call[0] as string[]
    // Only the still-visible human survives; the hidden human and her Bot are both gone.
    expect(submittedUids).toEqual(['u_grace'])
    expect(submittedUids).not.toContain('u_ada')
    expect(submittedUids).not.toContain('b_1')
    // No bot snapshot arg (or an empty botUids) — a hidden creator's Bot never submits.
    if (call[2]) expect(call[2].botUids).not.toContain('b_1')
  })

  it('stops nesting a selected Bot whose creator becomes existing, but keeps it standalone', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    const { rerender } = render(
      <MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />,
    )
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Select Ada (auto-selects her Bot b_1) plus Grace so a human survives after Ada is added.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('Grace Hopper'))
    // Ada gets added elsewhere. Her Bot remains independently grantable as a standalone row.
    rerender(
      <MemberPicker space="s_1" existingUids={new Set(['u_ada'])} onAdd={onAdd} />,
    )
    const addBtn = document.querySelector(
      '.octo-member-picker-actions .octo-doc-primary-btn',
    ) as HTMLButtonElement
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledTimes(1)
    const call = onAdd.mock.calls[0]
    const submittedUids = call[0] as string[]
    // The old nested selection is pruned; it does not silently ride along with Grace.
    expect(submittedUids).toEqual(['u_grace'])
    expect(submittedUids).not.toContain('b_1')
    if (call[2]) expect(call[2].botUids).not.toContain('b_1')
  })
})

// Latest P1 (creator_uid-missing): a Space-Bot catalog entry with no creator_uid has no viewer-
// scoped provenance, so it MUST NOT become a grantable standalone. Only an already-granted
// creator-less Bot stays visible — disabled. Member-roster / friend Bots keep their grantability.
describe('MemberPicker creator-less Space Bots (P1 provenance)', () => {
  function botResponder(bots: Array<{ uid: string; name: string; creator_uid?: string }>) {
    return (method: string, url: string) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: bots, status: 200 }
        : { data: [], status: 200 }
  }

  it('never offers a creator-less catalog-only Bot as a grantable standalone', async () => {
    wk.apiClient.responder = botResponder([{ uid: 'b_orphan', name: 'Orphan Catalog Bot' }])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    // The creator-less catalog Bot is not listed at all (no safe provenance to grant it alone).
    expect(screen.queryByText('Orphan Catalog Bot')).toBeNull()
  })

  it('does not let a DUPLICATE creator-less catalog row (same uid) bootstrap trust', async () => {
    // Two catalog-only rows share b_dup and neither is a member/friend. The second row must not
    // gain safeStandalone from the first — it stays ungrantable (regression: trust from any prev).
    wk.apiClient.responder = botResponder([
      { uid: 'b_dup', name: 'Dup Catalog Bot' },
      { uid: 'b_dup', name: 'Dup Catalog Bot' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.queryByText('Dup Catalog Bot')).toBeNull()
  })

  it('keeps an already-granted creator-less Bot visible but disabled', async () => {
    wk.apiClient.responder = botResponder([{ uid: 'b_orphan', name: 'Granted Orphan' }])
    render(<MemberPicker space="s_1" existingUids={new Set(['b_orphan'])} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Granted Orphan')).toBeTruthy())
    const row = screen.getByText('Granted Orphan').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(screen.getByText('docs.member.alreadyAdded')).toBeTruthy()
  })

  it('still offers a creator-less owned agent (owned_bots provenance)', async () => {
    wk.apiClient.responder = (_m: string, url: string) =>
      url.startsWith('/robot/owned_bots')
        ? { data: [{ uid: 'u_ownedbot', name: 'Owned Bot' }], status: 200 }
        : { data: [], status: 200 }
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Owned Bot')).toBeTruthy())
    const row = screen.getByText('Owned Bot').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(false)
    fireEvent.click(screen.getByText('Owned Bot'))
    fireEvent.click(screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ownedbot'], 'writer', { humanUids: [], botUids: ['u_ownedbot'] })
  })

  it('still offers a creator-less Bot that is itself a Space member', async () => {
    // u_bot is a member-roster Bot (from spaceMembers) with no creator_uid — grantable standalone.
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Helper Bot')).toBeTruthy())
    const row = screen.getByText('Helper Bot').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(false)
  })
})

// MemberPicker UX (task #3): the Bot expander is available on EVERY human with eligible nested
// Bots regardless of selected state. Expanding an unselected person is a read-only preview that
// creates NO Bot selection; the expander never toggles the human; selecting defaults the Bots on;
// selection survives collapse/expand; a query-driven expand leaves no hidden selection on clear.
describe('MemberPicker Bot expander UX (task #3)', () => {
  function botResponder(bots: Array<{ uid: string; name: string; creator_uid?: string }>) {
    return (method: string, url: string) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: bots, status: 200 }
        : { data: [], status: 200 }
  }

  it('shows the expander for an UNSELECTED person and previews Bots read-only (no selection)', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Expander present without selecting Ada; clicking it does NOT select Ada.
    fireEvent.click(screen.getByText('docs.member.showBots'))
    const adaRow = screen.getByText('Ada Lovelace').closest('button') as HTMLButtonElement
    expect(adaRow.classList.contains('is-selected')).toBe(false)
    // The previewed Bot checkbox is disabled and unchecked (display-only).
    const botCheckbox = screen.getByText('Writer Bot').closest('label')!.querySelector('input') as HTMLInputElement
    expect(botCheckbox.disabled).toBe(true)
    expect(botCheckbox.checked).toBe(false)
    // Attempting to toggle it changes nothing; Add stays disabled (no selection at all).
    fireEvent.click(botCheckbox)
    expect((screen.getByText('docs.member.add').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('selecting the person defaults all their Bots and lets one be cancelled', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
      { uid: 'b_2', name: 'Review Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    // Both default checked + enabled once the person is selected.
    const b1 = screen.getByText('Writer Bot').closest('label')!.querySelector('input') as HTMLInputElement
    const b2 = screen.getByText('Review Bot').closest('label')!.querySelector('input') as HTMLInputElement
    expect(b1.checked && b2.checked).toBe(true)
    expect(b1.disabled).toBe(false)
    fireEvent.click(b2) // cancel one
    fireEvent.click(screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada', 'b_1'], 'writer', { humanUids: ['u_ada'], botUids: ['b_1'] })
  })

  it('preserves Bot selection across collapse/expand', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
      { uid: 'b_2', name: 'Review Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    fireEvent.click(screen.getByText('Review Bot').closest('label')!.querySelector('input') as HTMLInputElement) // cancel b_2
    fireEvent.click(screen.getByText('docs.member.hideBots')) // collapse
    fireEvent.click(screen.getByText('docs.member.showBots')) // re-expand
    const b1 = screen.getByText('Writer Bot').closest('label')!.querySelector('input') as HTMLInputElement
    const b2 = screen.getByText('Review Bot').closest('label')!.querySelector('input') as HTMLInputElement
    // b_1 still selected, b_2 still cancelled across the collapse/expand cycle.
    expect(b1.checked).toBe(true)
    expect(b2.checked).toBe(false)
  })

  it('excludes a stale standalone Bot from the payload after a real selection + query/topology transition', async () => {
    // A creator-less OWNED bot is a real, grantable standalone. Select it, then a topology change
    // removes it from the offered roster (owner reassigned it / it left the space) on rerender. The
    // Add button must disable and any submit must NOT carry the vanished uid (not tautological: the
    // uid WAS selected and enabled before the transition).
    let ownedResponse: Array<{ uid: string; name: string }> = [{ uid: 'u_ownedbot', name: 'Owned Bot' }]
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/owned_bots') ? { data: ownedResponse, status: 200 } : { data: [], status: 200 }
    const onAdd = vi.fn()
    const { rerender } = render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Owned Bot')).toBeTruthy())
    // Real selection: the standalone Bot is enabled and ticked.
    fireEvent.click(screen.getByText('Owned Bot'))
    const addBtn = screen.getByText('docs.member.addSnapshotCount').closest('button') as HTMLButtonElement
    expect(addBtn.disabled).toBe(false)
    // Topology transition: owned_bots no longer returns it (and re-fetch triggered by remount key).
    ownedResponse = []
    rerender(<MemberPicker space="s_1" key="reload" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.queryByText('Owned Bot')).toBeNull())
    // The vanished uid was pruned: Add is disabled again, nothing submits.
    expect(
      (screen.getByText('docs.member.add').closest('button') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(onAdd).not.toHaveBeenCalled()
  })

  // Bug (task): a query hit auto-expands a creator's Bot list. The user must be able to collapse
  // that query-expanded list and have it STAY collapsed for the current term; a new term restores
  // the "hit ⇒ default open" convenience; and manual collapse→expand must still work (no dead click).
  it('lets the user collapse a query-expanded Bot list (stays collapsed under the same query)', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Query hits the Bot → its list defaults open (protects the current convenience).
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'Writer Bot' },
    })
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    // The expander reads as expanded (label = hideBots).
    expect(screen.getByText('docs.member.hideBots')).toBeTruthy()
    // Click “collapse” → the Bot row disappears and the label flips back to showBots (FAILS before fix).
    fireEvent.click(screen.getByText('docs.member.hideBots'))
    expect(screen.queryByText('Writer Bot')).toBeNull()
    expect(screen.getByText('docs.member.showBots')).toBeTruthy()
  })

  it('restores the default-open on a new query term after a manual collapse', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const search = screen.getByPlaceholderText('docs.member.pickPlaceholder')
    fireEvent.change(search, { target: { value: 'Writer' } })
    // Manually collapse the query-expanded list.
    fireEvent.click(screen.getByText('docs.member.hideBots'))
    expect(screen.queryByText('Writer Bot')).toBeNull()
    // A different term that still hits the Bot clears the override → defaults open again.
    fireEvent.change(search, { target: { value: 'Bot' } })
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    expect(screen.getByText('docs.member.hideBots')).toBeTruthy()
  })

  it('allows manual collapse then manual re-expand (direction toggle never dead-locks)', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'Writer Bot' },
    })
    // collapse …
    fireEvent.click(screen.getByText('docs.member.hideBots'))
    expect(screen.queryByText('Writer Bot')).toBeNull()
    // … then re-expand on the very next click (a single click must flip it back open).
    fireEvent.click(screen.getByText('docs.member.showBots'))
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    expect(screen.getByText('docs.member.hideBots')).toBeTruthy()
  })
})

// Latest blocking P1 (yujiawei): selection reachability across live rerenders. A selected human
// whose creator/roster row disappears — because the person left the space or the roster reloaded
// without them — must be pruned so it can never ride along in the submitted snapshot, and their
// auto-selected Bots must go with them. These are end-to-end-ish rerenders through the real
// candidate roster + prune effect + submit path (no internal stubbing of the invariant).
describe('MemberPicker selection reachability across rerenders (yujiawei P1)', () => {
  it('prunes a selected creator (and their Bots) when the creator leaves the roster', async () => {
    // Space s_1 has Ada+Grace+bot with Ada's Bot; space s_2 dropped Ada. Changing the `space` prop
    // re-fetches the roster on the SAME mount (no remount), so the prune effect — not a fresh mount
    // — is what removes the vanished creator + her auto-selected Bot.
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: [{ uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' }], status: 200 }
        : { data: [], status: 200 }
    wk.getSpaceMembers = async (spaceId: string) =>
      spaceId === 's_1'
        ? [
            { uid: 'u_ada', name: 'Ada Lovelace' },
            { uid: 'u_grace', name: 'Grace Hopper' },
          ]
        : [{ uid: 'u_grace', name: 'Grace Hopper' }]
    const onAdd = vi.fn()
    const { rerender } = render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    // Select Ada (auto-selects her Bot b_1) plus Grace so a human survives the topology change.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.showBots'))
    fireEvent.click(screen.getByText('Grace Hopper'))
    // Ada leaves: switch to s_2 (same mount, roster re-fetch without her).
    rerender(<MemberPicker space="s_2" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).toBeNull())
    const addBtn = document.querySelector(
      '.octo-member-picker-actions .octo-doc-primary-btn',
    ) as HTMLButtonElement
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledTimes(1)
    const submittedUids = onAdd.mock.calls[0][0] as string[]
    // Only the still-offered human survives; the vanished creator and her Bot are both gone.
    expect(submittedUids).toEqual(['u_grace'])
    expect(submittedUids).not.toContain('u_ada')
    expect(submittedUids).not.toContain('b_1')
    if (onAdd.mock.calls[0][2]) expect(onAdd.mock.calls[0][2].botUids).not.toContain('b_1')
  })

  it('prunes a selected human whose row disappears on a bare roster reload', async () => {
    wk.getSpaceMembers = async (spaceId: string) =>
      spaceId === 's_1'
        ? [
            { uid: 'u_ada', name: 'Ada Lovelace' },
            { uid: 'u_grace', name: 'Grace Hopper' },
          ]
        : [{ uid: 'u_ada', name: 'Ada Lovelace' }]
    const onAdd = vi.fn()
    const { rerender } = render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('Grace Hopper'))
    // Roster reload (space switch) drops Grace entirely.
    rerender(<MemberPicker space="s_2" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).toBeNull())
    fireEvent.click(document.querySelector('.octo-member-picker-actions .octo-doc-primary-btn') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledTimes(1)
    const submittedUids = onAdd.mock.calls[0][0] as string[]
    expect(submittedUids).toEqual(['u_ada'])
    expect(submittedUids).not.toContain('u_grace')
  })
})

// Collapse-override semantics (intentional — not a bug). A review P1 argued that a manual expand
// that the user later collapses (while a query is active) is "silently destroyed" on query clear,
// and proposed keeping the uid in `expanded` on collapse (only recording collapsedByUser). We
// reject that: the LAST EXPLICIT user action wins, so an explicit collapse must survive the query
// clearing. The proposed change would also introduce a real "ghost EXPAND" (test (b)): a later
// query — even one that does not hit this Bot — clears collapsedByUser and re-opens a list the user
// closed. These two tests pin that contract. NOTE: if someone "fixes" per the review by removing
// `expanded.delete(m.uid)` from the collapse branch of the expander onClick, test (b) fails.
describe('MemberPicker collapse-override semantics (review P1 rejected)', () => {
  function botResponder(bots: Array<{ uid: string; name: string; creator_uid?: string }>) {
    return (method: string, url: string) =>
      method === 'get' && url.startsWith('/robot/space_bots')
        ? { data: bots, status: 200 }
        : { data: [], status: 200 }
  }

  // (a) An explicit collapse survives clearing the search: manual expand (no query) → type a query
  // that hits the Bot → collapse → clear the query. The list stays CLOSED because the user's last
  // explicit action was "collapse" (last-explicit-action-wins). This is deliberate, not a bug.
  it('keeps an explicit collapse closed after the search is cleared', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const search = screen.getByPlaceholderText('docs.member.pickPlaceholder')
    // Manual expand with NO query active.
    fireEvent.click(screen.getByText('docs.member.showBots'))
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    // Type a query that hits the Bot (list stays open).
    fireEvent.change(search, { target: { value: 'Writer Bot' } })
    expect(screen.getByText('docs.member.hideBots')).toBeTruthy()
    // Explicit collapse.
    fireEvent.click(screen.getByText('docs.member.hideBots'))
    expect(screen.queryByText('Writer Bot')).toBeNull()
    // Clear the query — the list stays CLOSED (last explicit action = collapse wins).
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.queryByText('Writer Bot')).toBeNull()
    expect(screen.getByText('docs.member.showBots')).toBeTruthy()
  })

  // (b) Guardrail against the review's proposed change: a list closed by the user must NOT re-open
  // itself when a later query merely matches the PERSON (not the Bot). Manual expand (no query) →
  // collapse (still no query) → search the human's name "Ada" (matches Ada, NOT "Writer Bot"). The
  // Bot list must stay CLOSED. If collapse kept the uid in `expanded` (the review's suggestion),
  // the [query] effect would clear collapsedByUser and the still-`expanded` uid would pop open — a
  // real ghost-expand. This test FAILS if `expanded.delete(m.uid)` is removed from the collapse
  // branch of the expander onClick.
  it('does not self-expand a user-collapsed list when a later query matches only the person', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const search = screen.getByPlaceholderText('docs.member.pickPlaceholder')
    // Manual expand then collapse, all with NO query active.
    fireEvent.click(screen.getByText('docs.member.showBots'))
    expect(screen.getByText('Writer Bot')).toBeTruthy()
    fireEvent.click(screen.getByText('docs.member.hideBots'))
    expect(screen.queryByText('Writer Bot')).toBeNull()
    // Search by the PERSON's name "Ada" — matches Ada, does NOT hit "Writer Bot".
    fireEvent.change(search, { target: { value: 'Ada' } })
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    // The user-closed Bot list must stay CLOSED (no ghost-expand).
    expect(screen.queryByText('Writer Bot')).toBeNull()
    expect(screen.getByText('docs.member.showBots')).toBeTruthy()
  })
})
