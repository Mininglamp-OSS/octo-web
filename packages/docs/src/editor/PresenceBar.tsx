import { useEffect, useState } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { readOnlineUsers, colorFromId, type OctoAwarenessUser } from '../awareness/presence.ts'
import type { ConnState } from '../collab/createCollabEditor.ts'

// PresenceBar (frontend-design §5.3 / §5.4): online users + connection state.
export function PresenceBar({
  provider,
  connState,
  synced,
  names,
}: {
  provider: HocuspocusProvider
  connState: ConnState | null
  synced: boolean
  /**
   * Optional uid → display-name directory (the space-member map). When supplied, the avatar
   * initial and tooltip resolve through it keyed by the peer's uid, so a peer that published its
   * raw uid as its awareness name (its own member list had not resolved yet) still shows a human
   * name here (XIN-680). Falls back to the published name when the uid is unknown, so omitting it
   * preserves the prior behaviour.
   */
  names?: ReadonlyMap<string, string>
}) {
  const [users, setUsers] = useState<OctoAwarenessUser[]>([])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness) return
    const update = () => setUsers(readOnlineUsers(awareness))
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [provider])

  const status =
    connState === 'connecting'
      ? { label: 'Connecting…', cls: 'is-connecting' }
      : synced
        ? { label: 'Synced', cls: 'is-synced' }
        : connState === 'disconnected'
          ? { label: 'Offline — changes sync on reconnect', cls: 'is-offline' }
          : { label: 'Connected', cls: 'is-connected' }

  return (
    <div className="octo-presence-bar">
      <div className="octo-presence-avatars">
        {users.slice(0, 5).map((u) => {
          // Prefer the viewer's authoritative directory name over the peer-published one, keyed by
          // uid; fall back to the published name (which may itself be the uid) when unknown.
          const displayName = names?.get(u.id) || u.name
          return (
            <span
              key={u.id}
              className="octo-avatar"
              title={displayName}
              style={{ backgroundColor: colorFromId(u.id) }}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )
        })}
        {users.length > 5 && <span className="octo-avatar octo-avatar-more">+{users.length - 5}</span>}
      </div>
      <span className={`octo-conn-status ${status.cls}`}>{status.label}</span>
    </div>
  )
}
