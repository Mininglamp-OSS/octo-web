import { useEffect, useState } from 'react'
import { getSpaceMemberNames, getSpaceMemberDirectory, type SpaceMemberDirectory } from './memberNames.ts'

/**
 * Subscribe a component to the space's uid → display-name map (features #7 / #8). Returns an
 * empty map on first render and updates once the (cached) member list resolves. Resilient: the
 * underlying fetch never rejects, so a missing/slow member list just keeps the empty map and
 * callers fall back to the uid.
 */
export function useMemberNames(spaceId: string): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    let active = true
    void getSpaceMemberNames(spaceId).then((map) => {
      if (active) setNames(map)
    })
    return () => {
      active = false
    }
  }, [spaceId])
  return names
}

const EMPTY_DIRECTORY: SpaceMemberDirectory = { names: new Map(), botUids: new Set() }

/**
 * Subscribe a component to the space's full directory (names + bot uids). Shares the SAME cached
 * fetch as useMemberNames (one Promise.all per space), so adding this hook next to useMemberNames
 * costs no extra request. Returns an empty directory (empty names, empty botUids) until it
 * resolves — the panel treats an empty `botUids` as "everyone is a human" (fail-soft).
 */
export function useMemberDirectory(spaceId: string): SpaceMemberDirectory {
  const [directory, setDirectory] = useState<SpaceMemberDirectory>(() => EMPTY_DIRECTORY)
  useEffect(() => {
    let active = true
    void getSpaceMemberDirectory(spaceId).then((d) => {
      if (active) setDirectory(d)
    })
    return () => {
      active = false
    }
  }, [spaceId])
  return directory
}
