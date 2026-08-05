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
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
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
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
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

// #839: the candidate roster merges the caller's friend-added agents (GET /robot/my_bots) with
// the space members, so an agent owned by someone else but befriended by the caller — which the
// space-member query filters out — becomes selectable, while non-friend agents never appear.
describe('MemberPicker friend-agent roster (#839)', () => {
  it('merges friend agents from my_bots and dedups by uid', async () => {
    // my_bots returns a friend agent owned by someone else (not in spaceMembers) plus a duplicate
    // of an existing space bot (u_bot) that must NOT render twice.
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/my_bots')
        ? {
            data: [
              { uid: 'u_friendbot', name: 'Friend Bot' },
              { uid: 'u_bot', name: 'Helper Bot (dup)' },
            ],
            status: 200,
          }
        : { data: {}, status: 200 }
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Friend Bot')).toBeTruthy())
    // The space-member entry wins on the uid collision (its name, rendered once).
    expect(screen.getAllByText('Helper Bot')).toHaveLength(1)
    expect(screen.queryByText('Helper Bot (dup)')).toBeNull()
    // The friend agent carries the AI badge (one for u_bot, one for u_friendbot).
    expect(screen.getAllByText('docs.member.aiTag')).toHaveLength(2)
    // It is selectable and adds by its uid.
    const addBtn = screen.getByText('docs.member.add').closest('button') as HTMLButtonElement
    fireEvent.click(screen.getByText('Friend Bot'))
    expect(addBtn.disabled).toBe(false)
  })

  it('renders the space roster unchanged when my_bots fails', async () => {
    wk.apiClient.responder = (_m, url) => {
      if (url.startsWith('/robot/my_bots')) throw new Error('boom')
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

  it('still offers a creator-less friend agent (my_bots provenance)', async () => {
    wk.apiClient.responder = (_m: string, url: string) =>
      url.startsWith('/robot/my_bots')
        ? { data: [{ uid: 'u_friendbot', name: 'Friend Bot' }], status: 200 }
        : { data: [], status: 200 }
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Friend Bot')).toBeTruthy())
    const row = screen.getByText('Friend Bot').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(false)
    fireEvent.click(screen.getByText('Friend Bot'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_friendbot'], 'writer', { humanUids: [], botUids: ['u_friendbot'] })
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

  it('leaves no hidden Bot selection after the search query clears', async () => {
    wk.apiClient.responder = botResponder([
      { uid: 'b_1', name: 'Writer Bot', creator_uid: 'u_ada' },
    ])
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const search = screen.getByPlaceholderText('docs.member.pickPlaceholder')
    // Search a Bot: its creator row + preview surface, but WITHOUT selecting the creator the Bot
    // control is disabled, so no selection can be created via search.
    fireEvent.change(search, { target: { value: 'Writer Bot' } })
    const botCheckbox = screen.getByText('Writer Bot').closest('label')!.querySelector('input') as HTMLInputElement
    expect(botCheckbox.disabled).toBe(true)
    fireEvent.click(botCheckbox)
    // Clear the query — nothing was selected, so Add stays disabled (no invisible submission).
    fireEvent.change(search, { target: { value: '' } })
    expect((screen.getByText('docs.member.add').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
