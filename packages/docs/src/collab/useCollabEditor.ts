// React binding for the collaborative editor (frontend-design §4.3).
//
// A document-level registry keyed by `${uid}::${documentName}` makes account / document
// switches isolate naturally and survives StrictMode's double-invoked effects (idempotent
// create + refcount). Readiness is exposed through useSyncExternalStore so renders see a
// consistent snapshot rather than a mutable ref.

import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { CollabEditor, type CollabEditorOptions, type ConnState, type TerminalState } from './createCollabEditor.ts'
import type { Role } from '../auth/roles.ts'

interface RegistryEntry {
  refCount: number
  instance: CollabEditor | null
  promise: Promise<CollabEditor>
}

const registry = new Map<string, RegistryEntry>()

function acquire(key: string, opts: CollabEditorOptions): RegistryEntry {
  let entry = registry.get(key)
  if (!entry) {
    const created = CollabEditor.create(opts)
    entry = { refCount: 0, instance: null, promise: created }
    created.then((inst) => {
      const e = registry.get(key)
      if (e) e.instance = inst
      else inst.destroyAll() // released before creation finished
    })
    registry.set(key, entry)
  }
  entry.refCount++
  return entry
}

function release(key: string): void {
  const entry = registry.get(key)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    registry.delete(key)
    entry.promise.then((inst) => {
      // Only destroy if no one re-acquired under the same key meanwhile.
      if (!registry.has(key)) inst.destroyAll()
    })
  }
}

export interface UseCollabEditorResult {
  instance: CollabEditor | null
  ready: boolean
  role: Role | null
  connState: ConnState | null
  terminal: TerminalState
}

export function useCollabEditor(opts: CollabEditorOptions): UseCollabEditorResult {
  const { uid, space, folder, doc } = opts
  const key = `${uid}::octo:${space}:${folder}:${doc}`

  const instRef = useRef<CollabEditor | null>(null)
  const [, force] = useState(0)
  const [role, setRole] = useState<Role | null>(null)
  const [connState, setConnState] = useState<ConnState | null>(null)
  const [terminal, setTerminal] = useState<TerminalState>({ kind: 'none' })

  useEffect(() => {
    let active = true
    const merged: CollabEditorOptions = {
      ...opts,
      onRole: (r) => {
        if (active) setRole(r)
        opts.onRole?.(r)
      },
      onConnState: (s) => {
        if (active) setConnState(s)
        opts.onConnState?.(s)
      },
      onTerminal: (t) => {
        if (active) setTerminal(t)
        opts.onTerminal?.(t)
      },
    }
    const entry = acquire(key, merged)
    entry.promise.then((inst) => {
      if (!active) return
      instRef.current = inst
      setRole(inst.getRole())
      force((n) => n + 1)
    })
    return () => {
      active = false
      instRef.current = null
      release(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]) // ⚠️ keyed by uid + documentName — switching either rebuilds.

  const ready = useSyncExternalStore(
    (cb) => instRef.current?.subscribeReady(cb) ?? (() => {}),
    () => instRef.current?.isReady() ?? false,
  )

  return { instance: instRef.current, ready, role, connState, terminal }
}
