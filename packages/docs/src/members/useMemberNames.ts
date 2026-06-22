import { useEffect, useState } from 'react'
import { getSpaceMemberNames } from './memberNames.ts'

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
