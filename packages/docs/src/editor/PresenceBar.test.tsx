import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { PresenceBar } from './PresenceBar.tsx'

// XIN-680: after the duplicate Excalidraw avatar stack was removed, the remaining canonical
// presence display is this header PresenceBar. Its avatar initial + tooltip must resolve the
// human display name, not the raw uid a peer may have published as its awareness name (its own
// member list not yet resolved). These tests drive that resolution through the `names` directory.

const UID = '5904fca8ebe44ee6a8d8d7bd92228e0e' // the raw 32-hex id from the boss screenshot

/** Minimal awareness stub exposing exactly what readOnlineUsers + PresenceBar's effect touch. */
function providerWith(user: { id: string; name: string }): HocuspocusProvider {
  const awareness = {
    getStates: () => new Map([[1, { user: { ...user, color: '#fff' } }]]),
    on: () => {},
    off: () => {},
    clientID: 0,
  }
  return { awareness } as unknown as HocuspocusProvider
}

afterEach(() => cleanup())

describe('PresenceBar avatar name resolution (XIN-680)', () => {
  it('resolves the initial + tooltip from the directory when the peer published its raw uid', () => {
    render(
      <PresenceBar
        provider={providerWith({ id: UID, name: UID })}
        connState="connected"
        synced
        names={new Map([[UID, 'Ada Lovelace']])}
      />,
    )
    const avatar = screen.getByTitle('Ada Lovelace')
    expect(avatar.textContent).toBe('A') // initial from the name, not the hex uid
  })

  it('falls back to the published name when the uid is unknown to the directory', () => {
    render(
      <PresenceBar
        provider={providerWith({ id: 'u2', name: 'Bob' })}
        connState="connected"
        synced
        names={new Map()}
      />,
    )
    const avatar = screen.getByTitle('Bob')
    expect(avatar.textContent).toBe('B')
  })

  it('without a directory, keeps the prior behaviour (published name)', () => {
    render(
      <PresenceBar provider={providerWith({ id: 'u3', name: 'Carol' })} connState="connected" synced />,
    )
    expect(screen.getByTitle('Carol').textContent).toBe('C')
  })
})
