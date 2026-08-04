import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import type { ImSubscriberLike } from "../../../im-runtime/channelRuntime"
import {
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../../im-runtime/currentChannelRuntime"
import SpaceBotService from "../../../Service/SpaceBotService"
import type { ForwardBotCreatorGroup, ForwardBotSnapshot } from "../grant"

/** Injectable name lookup so the panel can show a display name instead of a raw uid. */
export type ForwardNameResolver = (uid: string) => string

interface ResolvedModel {
  peopleUids: string[]
  botsByCreator: Map<string, Array<{ uid: string; name: string }>>
}

export interface UseForwardBotSnapshotResult {
  /** Render model for the 授权区 Bot expander (undefined when gated off). */
  snapshot: ForwardBotSnapshot | undefined
  /**
   * Stable getter for the confirm path: returns the currently-selected (non-cancelled) Bot uids
   * for the CURRENT target/space, read at call time. The hook keeps the backing state in refs that
   * are updated only in commit/event phases (async resolve, toggle, target invalidation) — never
   * during render — so confirm always sees the freshest set without a render-phase ref write and
   * without depending on a passive effect having flushed. While loading / gated off → [].
   */
  readLatestSelectedBotUids: () => string[]
}

/** Compute the selected (non-cancelled) Bot uids from a resolved model. */
function selectedFrom(resolved: ResolvedModel | null, cancelled: Set<string>): string[] {
  if (!resolved) return []
  const out: string[] = []
  for (const list of resolved.botsByCreator.values())
    for (const b of list) if (!cancelled.has(b.uid)) out.push(b.uid)
  return [...new Set(out)]
}

/**
 * 授权区 Bot 展开器的数据 hook（feature: user+Bot grants）。
 *
 * 把选中目标展开成去重人员 uid，再用 `SpaceBotService.list(spaceId)` 拉 Space Bot 按 creator_uid
 * 归到人员下，形成每人可展开的 Bot 分组（默认全选，逐个可取消）。无 Bot / Bot 拉取失败 → 返回一个
 * `ready:true, groups:[]` 的空快照，授权区不渲染 Bot 行，转发照常走人员授权（zero-Bot 兼容）。
 *
 * loading/stale 语义（避免旧 Bot 被误确认）：目标/space/enabled 变化时立即丢弃旧 resolved 并置
 * `ready:false`（loading）；新一轮 async 完成前 snapshot 不含任何 Bot，`readLatestSelectedBotUids()`
 * 同步返回 []，所以调用方在旧结果失效后、新结果就绪前绝不会携带过期 Bot。每轮以 generation ref 作
 * stale guard；选中集合镜像到 ref，仅在 commit/事件阶段更新，供 confirm 无 render 副作用地读取。
 */
export function useForwardBotSnapshot(
  selectedIDs: string[],
  selectedChannels: Channel[],
  spaceId: string | undefined,
  enabled: boolean,
  resolveName?: ForwardNameResolver,
): UseForwardBotSnapshotResult {
  const selectedKey = useMemo(() => selectedIDs.join(","), [selectedIDs])
  const resolvedKey = useMemo(
    () => selectedChannels.map((ch) => `${ch.channelID}:${ch.channelType}`).join(","),
    [selectedChannels],
  )

  // Resolved model from the async pass. `null` = still loading (or gated off); it is cleared the
  // instant the target/space/enabled inputs change so a stale model can never leak into confirm.
  const [resolved, setResolved] = useState<ResolvedModel | null>(null)
  // Bot uids the user has CANCELLED (default is "all selected", so we track the negatives).
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set())
  // Monotonic run id: only the newest run may commit, so an in-flight fetch for a superseded
  // target/space never overwrites a fresher one (stale guard without relying on cleanup timing).
  const generation = useRef(0)

  // Confirm-time mirror of {resolved, cancelled}, updated ONLY in commit/event phases below. This
  // is what readLatestSelectedBotUids() reads — never written during render.
  const resolvedRef = useRef<ResolvedModel | null>(resolved)
  const cancelledRef = useRef<Set<string>>(cancelled)

  useEffect(() => {
    const gen = ++generation.current
    // Any input change invalidates the previous model immediately → loading (ready:false), so the
    // snapshot below reports no Bots and the confirm getter returns [] until this run's result lands.
    setResolved(null)
    resolvedRef.current = null
    if (!enabled || !spaceId || selectedChannels.length !== selectedIDs.length) return

    const commit = (model: ResolvedModel) => {
      if (generation.current !== gen) return
      setResolved(model)
      resolvedRef.current = model
      cancelledRef.current = new Set() // fresh resolution starts from "all selected"
    }

    void (async () => {
      // 1) expand targets → distinct people uids (person peer + group members).
      const people = new Set<string>()
      for (const ch of selectedChannels) {
        if (ch.channelType === ChannelTypePerson) {
          if (ch.channelID) people.add(ch.channelID)
          continue
        }
        try {
          await syncCurrentImChannelSubscribers(ch)
        } catch {
          // best-effort: fall back to whatever is already cached
        }
        if (generation.current !== gen) return
        const subs = getCurrentImChannelSubscribers<Channel, ImSubscriberLike>(ch)
        for (const s of subs) if (typeof s?.uid === "string" && s.uid) people.add(s.uid)
      }

      // 2) fetch Space Bots and group by creator — only creators present in the people snapshot.
      let bots: Array<{ uid?: string; name?: string; creator_uid?: string }> = []
      try {
        bots = await SpaceBotService.list(spaceId)
      } catch {
        bots = [] // fail-soft: no Bot rows, human-only grant
      }
      if (generation.current !== gen) return

      const byCreator = new Map<string, Array<{ uid: string; name: string }>>()
      for (const bot of bots) {
        if (!bot?.uid || !bot.creator_uid || !people.has(bot.creator_uid)) continue
        const list = byCreator.get(bot.creator_uid) ?? []
        list.push({ uid: bot.uid, name: bot.name || bot.uid })
        byCreator.set(bot.creator_uid, list)
      }

      commit({ peopleUids: [...people], botsByCreator: byCreator })
    })()

    return () => {
      // Bump the generation so a late-resolving fetch for this (now superseded) run is discarded.
      generation.current++
    }
    // selectedKey/resolvedKey carry the "which targets" semantics; spaceId/enabled gate the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, resolvedKey, spaceId, enabled])

  // A fresh resolution clears prior cancellations so re-opening starts from "all selected".
  useEffect(() => {
    setCancelled(new Set())
  }, [resolved])

  // Toggle keeps the state and the confirm mirror in lockstep, both in the event phase.
  const toggleBot = useCallback((uid: string) => {
    setCancelled((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      cancelledRef.current = next
      return next
    })
  }, [])

  const readLatestSelectedBotUids = useCallback((): string[] => {
    if (!enabled || !spaceId) return []
    return selectedFrom(resolvedRef.current, cancelledRef.current)
  }, [enabled, spaceId])

  const snapshot = useMemo<ForwardBotSnapshot | undefined>(() => {
    // Gated off (switch closed / no space / mismatched selection) → nothing to render at all.
    if (!enabled || !spaceId) return undefined

    // Still resolving: report a loading snapshot with NO Bots so confirm can never carry stale ones.
    if (!resolved) {
      return { ready: false, peopleCount: 0, botCount: 0, groups: [], toggleBot }
    }

    const groups: ForwardBotCreatorGroup[] = []
    let botCount = 0
    for (const [creatorUid, list] of resolved.botsByCreator) {
      const bots = list.map((b: { uid: string; name: string }) => {
        const selected = !cancelled.has(b.uid)
        if (selected) botCount++
        return { uid: b.uid, name: b.name, selected }
      })
      groups.push({
        uid: creatorUid,
        name: resolveName?.(creatorUid) || creatorUid,
        bots,
      })
    }

    return {
      ready: true,
      peopleCount: resolved.peopleUids.length,
      botCount,
      groups,
      toggleBot,
    }
  }, [enabled, spaceId, resolved, cancelled, resolveName, toggleBot])

  return { snapshot, readLatestSelectedBotUids }
}

/** Selected (non-cancelled) Bot uids from a READY snapshot — the set the grant actually adds.
 *  A loading (not-ready) or absent snapshot yields none, so a stale/in-flight resolve carries zero. */
export function selectedBotUids(snapshot: ForwardBotSnapshot | undefined): string[] {
  if (!snapshot || !snapshot.ready) return []
  const out: string[] = []
  for (const g of snapshot.groups) for (const b of g.bots) if (b.selected) out.push(b.uid)
  return [...new Set(out)]
}
