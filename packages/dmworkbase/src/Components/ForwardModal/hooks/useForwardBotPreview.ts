import { useCallback, useEffect, useRef, useState } from "react"
import SpaceBotService from "../../../Service/SpaceBotService"

/** One previewable Bot beneath a person candidate row (display-only until the target is selected). */
export interface ForwardBotPreviewItem {
  uid: string
  name: string
}

export interface UseForwardBotPreviewResult {
  /** True once the shared catalog has resolved for this space (preview rows may render). */
  ready: boolean
  /** Bots created by `creatorUid` among the whole-space catalog, or [] when none / not ready. */
  botsFor: (creatorUid: string) => ForwardBotPreviewItem[]
}

/**
 * Lazy, shared Space-Bot catalog reader for the ForwardModal person-row PREVIEW (UX #4).
 *
 * A forwarder may expand an UNSELECTED person candidate to inspect the Bots they created before
 * selecting them. This hook draws from the SAME shared catalog fetch (`SpaceBotService.listShared`)
 * the 授权区 selected-target snapshot uses, so preview and selected resolution stay consistent. It is
 * PREVIEW ONLY: it never selects a target and never contributes to the grant payload — the 授权区
 * GrantArea remains authoritative for what is actually granted.
 *
 * Fail-closed: on catalog error the preview simply exposes no Bots (ready stays false); the
 * authoritative snapshot path surfaces the retryable error. Grouping is by `creator_uid`, so
 * whole-space Bots are only ever shown under their creator person — never under a group/thread row.
 */
export function useForwardBotPreview(spaceId: string | undefined): UseForwardBotPreviewResult {
  const [ready, setReady] = useState(false)
  // creator_uid -> its Bots, from the shared catalog. Ref-backed so botsFor is stable.
  const byCreator = useRef<Map<string, ForwardBotPreviewItem[]>>(new Map())

  useEffect(() => {
    let active = true
    byCreator.current = new Map()
    setReady(false)
    if (!spaceId) return
    void SpaceBotService.listShared(spaceId)
      .then((bots) => {
        if (!active) return
        const grouped = new Map<string, ForwardBotPreviewItem[]>()
        for (const bot of bots) {
          if (!bot?.uid || !bot.creator_uid) continue
          const list = grouped.get(bot.creator_uid) ?? []
          list.push({ uid: bot.uid, name: bot.name || bot.uid })
          grouped.set(bot.creator_uid, list)
        }
        byCreator.current = grouped
        setReady(true)
      })
      .catch(() => {
        // Fail-closed: no preview Bots. The authoritative snapshot path owns the retryable error.
        if (active) setReady(false)
      })
    return () => {
      active = false
    }
  }, [spaceId])

  const botsFor = useCallback(
    (creatorUid: string) => byCreator.current.get(creatorUid) ?? [],
    // ready is a dep so consumers re-read once the catalog lands.
    [ready],
  )

  return { ready, botsFor }
}
