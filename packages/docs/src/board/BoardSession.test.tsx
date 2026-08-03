import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { WhiteboardSession } from './collab/connect.ts'

const sessions = vi.hoisted(() => ({
  byUid: new Map<string, WhiteboardSession | null>(),
}))
const shells = vi.hoisted(() => [] as Array<{
  uid?: string
  session?: WhiteboardSession | null
}>)

vi.mock('./collab/useWhiteboardSession.ts', () => ({
  useWhiteboardSession: ({ uid }: { uid: string }) => sessions.byUid.get(uid) ?? null,
}))
vi.mock('./BoardShell.tsx', () => ({
  BoardShell: (props: { user?: { id?: string }; collabSession?: WhiteboardSession | null }) => {
    shells.push({ uid: props.user?.id, session: props.collabSession })
    return <div data-testid="board-shell" />
  },
}))

import { BoardSession } from './BoardSession.tsx'

function fakeSession(id: string): WhiteboardSession {
  return { id } as unknown as WhiteboardSession
}

describe('BoardSession account switch identity/session pairing', () => {
  it('renders B first with no session, then B session, and never pairs B with A session', () => {
    shells.length = 0
    sessions.byUid.clear()
    const sessionA = fakeSession('A')
    const sessionB = fakeSession('B')
    sessions.byUid.set('u_a', sessionA)
    sessions.byUid.set('u_b', null)

    const view = render(
      <BoardSession docId="doc-1" title="Board" uid="u_a" space="s1" folder="f1" />,
    )
    expect(shells.at(-1)).toEqual({ uid: 'u_a', session: sessionA })

    // This is the key-change first frame contract supplied by useWhiteboardSession: user B must
    // reach BoardShell with null, never with A's stale provider/binding.
    view.rerender(
      <BoardSession docId="doc-1" title="Board" uid="u_b" space="s1" folder="f1" />,
    )
    expect(shells.at(-1)).toEqual({ uid: 'u_b', session: null })
    expect(shells).not.toContainEqual({ uid: 'u_b', session: sessionA })

    sessions.byUid.set('u_b', sessionB)
    view.rerender(
      <BoardSession docId="doc-1" title="Board" uid="u_b" space="s1" folder="f1" userName="B" />,
    )
    expect(shells.at(-1)).toEqual({ uid: 'u_b', session: sessionB })
    expect(shells).not.toContainEqual({ uid: 'u_b', session: sessionA })
  })
})
