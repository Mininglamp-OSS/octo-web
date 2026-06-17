import { useEffect, useState } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { readOnlineUsers, colorFromId, type OctoAwarenessUser } from '../awareness/presence.ts'
import type { ConnState } from '../collab/createCollabEditor.ts'

// PresenceBar (frontend-design §5.3 / §5.4): online users + connection state.
export function PresenceBar({
  provider,
  connState,
  synced,
}: {
  provider: HocuspocusProvider
  connState: ConnState | null
  synced: boolean
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
        {users.slice(0, 5).map((u) => (
          <span
            key={u.id}
            className="octo-avatar"
            title={u.name}
            style={{ backgroundColor: colorFromId(u.id) }}
          >
            {u.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
        {users.length > 5 && <span className="octo-avatar octo-avatar-more">+{users.length - 5}</span>}
      </div>
      <span className={`octo-conn-status ${status.cls}`}>{status.label}</span>
    </div>
  )
}
