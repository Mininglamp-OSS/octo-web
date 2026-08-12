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

const EMPTY_DIRECTORY: SpaceMemberDirectory = { names: new Map(), botUids: new Set(), botCreators: new Map() }

/** State shape for useMemberDirectory: directory keyed by spaceId to detect stale data on switch. */
interface KeyedDirectory {
  key: string
  dir: SpaceMemberDirectory
}

/**
 * Subscribe a component to the space's full directory (names + bot uids). Shares the SAME cached
 * fetch as useMemberNames (one Promise.all per space), so adding this hook next to useMemberNames
 * costs no extra request. Returns an empty directory (empty names, empty botUids) until it
 * resolves — the panel treats an empty `botUids` as "everyone is a human" (fail-soft).
 *
 * B2 fix: the directory is keyed by spaceId. When the spaceId changes, the hook returns
 * EMPTY_DIRECTORY until the new space's directory resolves — this prevents a brief window where
 * the OLD space's botUids could misclassify a real person as a bot (hiding them in a fold).
 * Fail-soft direction: unknown → human.
 */
export function useMemberDirectory(spaceId: string): SpaceMemberDirectory {
  const [stored, setStored] = useState<KeyedDirectory | null>(null)
  useEffect(() => {
    let active = true
    void getSpaceMemberDirectory(spaceId).then((d) => {
      if (active) setStored({ key: spaceId, dir: d })
    })
    return () => {
      active = false
    }
  }, [spaceId])
  // B2: only return the stored directory if its key matches the current spaceId; otherwise
  // return EMPTY_DIRECTORY so stale data from a previous space can never misclassify rows.
  return stored && stored.key === spaceId ? stored.dir : EMPTY_DIRECTORY
}
