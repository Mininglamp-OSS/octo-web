import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { clearMemberNameCache } from './memberNames.ts'
import { MemberPicker } from './MemberPicker.tsx'

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

  it('searches members server-side as you type (debounced), narrowing the list to matches', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'ada' },
    })
    // Search is server-side and debounced, so wait for the roster to reflect the query.
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).toBeNull())
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('finds a member via server search even when absent from the browse page (past-the-cap fix)', async () => {
    // Browse view returns only Grace; u_zoe is NOT in it, mirroring a member past the old 1000
    // client-fetch cap. Server search, however, can still surface her — the whole point of the fix.
    wk.getSpaceMembers = () => Promise.resolve([{ uid: 'u_grace', name: 'Grace Hopper' }])
    wk.searchSpaceMembers = (_s: string, kw: string) =>
      Promise.resolve(kw.toLowerCase().includes('zoe') ? [{ uid: 'u_zoe', name: 'Zoe Capped' }] : [])
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    // Zoe is invisible in the browse roster (she'd be past the cap)...
    expect(screen.queryByText('Zoe Capped')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('docs.member.pickPlaceholder'), {
      target: { value: 'zoe' },
    })
    // ...but the server-side keyword search finds her.
    await waitFor(() => expect(screen.getByText('Zoe Capped')).toBeTruthy())
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

  it('offers all three roles when roles prop is omitted (rich-doc: zero regression)', async () => {
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={() => {}} />)
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    // role dropdown options (the member rows use role="option" too, so filter to the <option>s).
    const roleOptions = options.filter((o) => o.tagName === 'OPTION')
    expect(roleOptions.map((o) => o.value)).toEqual(['reader', 'writer', 'admin'])
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

  it('falls back to the three default roles when roles={[]} (empty is a no-op, not a foot-gun)', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} roles={[]} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const roleOptions = (screen.getAllByRole('option') as HTMLElement[]).filter(
      (o) => o.tagName === 'OPTION',
    ) as HTMLOptionElement[]
    // Dropdown is non-empty (falls back to the three defaults) instead of rendering zero options.
    expect(roleOptions.map((o) => o.value)).toEqual(['reader', 'writer', 'admin'])
    // add() submits a valid Role ('writer' default), never undefined.
    fireEvent.click(screen.getByText('Ada Lovelace'))
    fireEvent.click(screen.getByText('docs.member.add').closest('button') as HTMLButtonElement)
    expect(onAdd).toHaveBeenCalledWith(['u_ada'], 'writer')
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
