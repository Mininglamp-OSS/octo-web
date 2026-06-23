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

  it('adds the selected member with the chosen role', async () => {
    const onAdd = vi.fn()
    render(<MemberPicker space="s_1" existingUids={new Set()} onAdd={onAdd} />)
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())

    // Add is disabled until a member is selected.
    const addBtn = screen.getByText('docs.member.add').closest('button') as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)

    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(addBtn.disabled).toBe(false)
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledWith('u_ada', 'writer')
  })
})
