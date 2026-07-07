// Pull-based access-request state (feature #511 screen 4c admin side, contract 4 / §4.2).
//
// Fetches pending requests on mount / when enabled, exposes the count for the Members red dot, and
// wraps approve/deny with an optimistic refresh. Pull-based by design (MVP does not push) — the
// panel and the red-dot both read this instead of waiting for a socket event.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listPendingAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
  type AccessRequest,
  type AccessRequestRole,
} from './api.ts'

export interface UseAccessRequestsResult {
  requests: AccessRequest[]
  /** Pending count, drives the Members-button red dot. */
  count: number
  loading: boolean
  error: boolean
  refresh: () => Promise<void>
  approve: (requestId: string, role: AccessRequestRole) => Promise<void>
  deny: (requestId: string) => Promise<void>
}

/**
 * `enabled` gates the fetch (only admins/owners should call the pending endpoint). When false the
 * hook stays inert (empty list, no request) so a non-admin never hits a 403.
 */
export function useAccessRequests(docId: string, enabled: boolean): UseAccessRequestsResult {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // Monotonic token bumped whenever (docId, enabled) changes or the hook unmounts
  // (see the effect below). A listPendingAccessRequests response that resolves
  // after its token was superseded is stale — it belongs to a doc/gate state that
  // is no longer current — so it is dropped instead of overwriting fresh state.
  const reqGenRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const gen = reqGenRef.current
    setLoading(true)
    setError(false)
    try {
      const list = await listPendingAccessRequests(docId)
      if (gen !== reqGenRef.current) return
      setRequests(list)
    } catch {
      if (gen !== reqGenRef.current) return
      setError(true)
    } finally {
      if (gen === reqGenRef.current) setLoading(false)
    }
  }, [docId, enabled])

  useEffect(() => {
    // Invalidate any request still in flight from the previous (docId, enabled).
    reqGenRef.current += 1
    if (!enabled) {
      setRequests([])
      setLoading(false)
      return
    }
    void refresh()
    return () => {
      // Unmount / dep change: drop a response that lands after we're gone.
      reqGenRef.current += 1
    }
  }, [enabled, refresh])

  const approve = useCallback(
    async (requestId: string, role: AccessRequestRole) => {
      await approveAccessRequest(docId, requestId, role)
      await refresh()
    },
    [docId, refresh],
  )

  const deny = useCallback(
    async (requestId: string) => {
      await denyAccessRequest(docId, requestId)
      await refresh()
    },
    [docId, refresh],
  )

  return { requests, count: requests.length, loading, error, refresh, approve, deny }
}
