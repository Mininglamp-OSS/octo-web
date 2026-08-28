import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import type { ImSubscriberLike } from "../../../im-runtime/channelRuntime"
import {
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../../im-runtime/currentChannelRuntime"
import SpaceBotService from "../../../Service/SpaceBotService"
import { subscriberDisplayName } from "../../../Utils/displayName"
import { mentionUidStateFromRobot } from "../../../Utils/mentionRender"
import type { ForwardBotCreatorGroup, ForwardBotSnapshot } from "../grant"
import {
  partitionForwardSubscribers,
  type ForwardSubscriberLike,
} from "../logic/partitionForwardSubscribers"

/** Injectable name lookup so the panel can show a display name instead of a raw uid. */
export type ForwardNameResolver = (uid: string) => string

interface ResolvedModel {
  key: string
  humanUids: string[]
  peopleNames: Map<string, string>
  botGroups: Map<string, { name: string; bots: Array<{ uid: string; name: string }> }>
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
  /** Human recipients from the same authoritative snapshot used by the Bot controls. */
  readLatestHumanUids: () => string[]
}

/** Compute the selected (non-cancelled) Bot uids from a resolved model. */
function selectedFrom(resolved: ResolvedModel | null, cancelled: Set<string>): string[] {
  if (!resolved) return []
  const out: string[] = []
  for (const group of resolved.botGroups.values())
    for (const b of group.bots) if (!cancelled.has(b.uid)) out.push(b.uid)
  return [...new Set(out)]
}

/**
 * 授权区 Bot 展开器的数据 hook（feature: user+Bot grants）。
 *
 * 把选中目标解析成去重的真人与 Bot：群聊只纳入群内实际成员，直接选中的真人还会按
 * `creator_uid` 带出其 Space Bot。Bot 按来源分组，默认全选且可逐个取消；roster/identity
 * lookup 失败则 fail-closed，显示可重试错误并阻止确认。
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
  // Resolved model from the async pass. `null` = still loading (or gated off). `resolutionKey`
  // synchronously hides a stale model during render; the effect then clears the stored value.
  const [resolved, setResolved] = useState<ResolvedModel | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const resolutionKey = useMemo(
    () => JSON.stringify([selectedKey, resolvedKey, spaceId ?? null, retryGeneration]),
    [selectedKey, resolvedKey, spaceId, retryGeneration],
  )
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
    // Clear the previous model when this run starts. The render-time resolutionKey check already
    // makes the stale model unreadable before this passive effect runs.
    setResolved(null)
    resolvedRef.current = null
    setLoadError(false)
    if (!enabled) return
    if (!spaceId || selectedChannels.length !== selectedIDs.length) {
      setLoadError(true)
      return
    }

    const commit = (model: ResolvedModel) => {
      if (generation.current !== gen) return
      setResolved(model)
      resolvedRef.current = model
      const available = new Set<string>()
      for (const group of model.botGroups.values())
        for (const bot of group.bots) available.add(bot.uid)
      const nextCancelled = new Set([...cancelledRef.current].filter((uid) => available.has(uid)))
      cancelledRef.current = nextCancelled
      setCancelled(nextCancelled)
    }

    void (async () => {
      // 1) Resolve the selected channel topology once. Keep direct-person targets separate from
      // group subscribers: selecting a group must not implicitly select every Space Bot created by
      // every human in that group.
      const directChannels: Channel[] = []
      const peopleNames = new Map<string, string>()
      const groupSnapshots: Array<{
        channel: Channel
        subscribers: ForwardSubscriberLike[]
      }> = []
      for (const ch of selectedChannels) {
        if (ch.channelType === ChannelTypePerson) {
          if (ch.channelID) directChannels.push(ch)
          continue
        }
        try {
          await syncCurrentImChannelSubscribers(ch)
        } catch {
          if (generation.current === gen) setLoadError(true)
          return
        }
        if (generation.current !== gen) return
        const subscribers = getCurrentImChannelSubscribers<Channel, ImSubscriberLike>(ch)
        groupSnapshots.push({ channel: ch, subscribers })
      }

      // 2) Fetch the Space Bot catalog. It is a fallback identity source and the source for Bots
      // owned by a DIRECTLY selected person; it is not a count of Bots present in a selected group.
      // Shared cached catalog read so the person-row preview and this selected-target resolution
      // draw from ONE consistent fetch (UX #4).
      let bots: Array<{ uid?: string; name?: string; creator_uid?: string }> = []
      try {
        bots = await SpaceBotService.listShared(spaceId)
      } catch {
        if (generation.current === gen) setLoadError(true)
        return
      }
      if (generation.current !== gen) return

      const knownBotUids = new Set<string>()
      const botByUid = new Map<string, (typeof bots)[number]>()
      for (const bot of bots) {
        if (!bot.uid) continue
        knownBotUids.add(bot.uid)
        botByUid.set(bot.uid, bot)
      }
      const humanUids = new Set<string>()
      const directHumanUids = new Set<string>()
      const botGroups = new Map<
        string,
        { name: string; bots: Array<{ uid: string; name: string }> }
      >()
      const seenBotUids = new Set<string>()

      // 3) Classify directly selected person-channel targets too. A Bot uses the same channel type
      // as a human, so channel type alone is not an identity signal. Prefer the Space roster's
      // positive Bot match, otherwise require explicit channel metadata and fail closed.
      for (const channel of directChannels) {
        const uid = channel.channelID
        const rosterBot = botByUid.get(uid)
        let channelInfo = getCurrentImChannelInfo(channel)
        let identity = rosterBot
          ? "bot"
          : mentionUidStateFromRobot(channelInfo?.orgData?.robot)

        if (identity === "unknown") {
          try {
            const fetched = await fetchCurrentImChannelInfo(channel)
            if (generation.current !== gen) return
            if (fetched && typeof fetched === "object") channelInfo = fetched
            else channelInfo = getCurrentImChannelInfo(channel)
            identity = mentionUidStateFromRobot(channelInfo?.orgData?.robot)
          } catch {
            if (generation.current === gen) setLoadError(true)
            return
          }
        }

        if (identity === "unknown") {
          if (generation.current === gen) setLoadError(true)
          return
        }
        if (identity === "user") {
          humanUids.add(uid)
          directHumanUids.add(uid)
          const name = resolveName?.(uid) || channelInfo?.title || uid
          if (name) peopleNames.set(uid, name)
          continue
        }

        if (seenBotUids.has(uid)) continue
        seenBotUids.add(uid)
        const name = rosterBot?.name || resolveName?.(uid) || channelInfo?.title || uid
        botGroups.set(`direct:${uid}`, {
          name,
          bots: [{ uid, name }],
        })
      }

      // 4) A selected group contributes its actual human members and its actual Bot members.
      // Unknown identities block this grant-critical snapshot instead of being silently treated as
      // humans, which would recreate the permission leak when metadata is stale or incomplete.
      for (const { channel, subscribers } of groupSnapshots) {
        const partitioned = partitionForwardSubscribers(subscribers, knownBotUids)
        if (partitioned.unknown.length > 0) {
          if (generation.current === gen) setLoadError(true)
          return
        }
        for (const member of partitioned.humans) {
          const uid = member.uid!
          humanUids.add(uid)
          const name = subscriberDisplayName({
            name: member.name,
            remark: member.remark,
            orgData: member.orgData,
          }).trim()
          if (name && !peopleNames.has(uid)) peopleNames.set(uid, name)
        }

        const groupBots: Array<{ uid: string; name: string }> = []
        for (const member of partitioned.bots) {
          const uid = member.uid!
          if (seenBotUids.has(uid)) continue
          seenBotUids.add(uid)
          const rosterBot = botByUid.get(uid)
          const memberName = subscriberDisplayName({
            name: member.name,
            remark: member.remark,
            orgData: member.orgData,
          }).trim()
          groupBots.push({ uid, name: rosterBot?.name || memberName || uid })
        }
        if (groupBots.length > 0) {
          botGroups.set(`group:${channel.channelID}`, {
            name: resolveName?.(channel.channelID) || channel.channelID,
            bots: groupBots,
          })
        }
      }

      // 5) Preserve the existing "selected person + their Space Bots" behavior only for a human
      // target the forwarder selected directly. Group membership is not transitive consent to all
      // Bots created by every human in that group.
      for (const bot of bots) {
        if (
          !bot?.uid ||
          !bot.creator_uid ||
          !directHumanUids.has(bot.creator_uid) ||
          seenBotUids.has(bot.uid)
        ) continue
        seenBotUids.add(bot.uid)
        const existing = botGroups.get(bot.creator_uid)
        const group = existing ?? {
          name: resolveName?.(bot.creator_uid) || bot.creator_uid,
          bots: [],
        }
        group.bots.push({ uid: bot.uid, name: bot.name || bot.uid })
        if (!existing) botGroups.set(bot.creator_uid, group)
      }

      commit({ key: resolutionKey, humanUids: [...humanUids], peopleNames, botGroups })
    })()

    return () => {
      // Bump the generation so a late-resolving fetch for this (now superseded) run is discarded.
      generation.current++
    }
    // resolutionKey carries target/space/retry identity; enabled gates the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolutionKey, enabled])

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
    const current = resolvedRef.current
    if (current?.key !== resolutionKey) return []
    return selectedFrom(current, cancelledRef.current)
  }, [enabled, spaceId, resolutionKey])

  const readLatestHumanUids = useCallback((): string[] => {
    if (!enabled || !spaceId) return []
    const current = resolvedRef.current
    return current?.key === resolutionKey ? current.humanUids : []
  }, [enabled, spaceId, resolutionKey])

  const retry = useCallback(() => setRetryGeneration((value: number) => value + 1), [])

  const snapshot = useMemo<ForwardBotSnapshot | undefined>(() => {
    // A closed switch is gated off. Missing document Space is an authorization lookup error.
    if (!enabled) return undefined

    // Loading/error snapshots carry no Bots and keep confirmation blocked.
    const currentResolved = resolved?.key === resolutionKey ? resolved : null
    if (!currentResolved) {
      return {
        ready: false,
        error: loadError,
        retry,
        peopleCount: 0,
        botCount: 0,
        groups: [],
        toggleBot,
      }
    }

    const groups: ForwardBotCreatorGroup[] = []
    let botCount = 0
    for (const [groupUid, group] of currentResolved.botGroups) {
      const bots = group.bots.map((b: { uid: string; name: string }) => {
        const selected = !cancelled.has(b.uid)
        if (selected) botCount++
        return { uid: b.uid, name: b.name, selected }
      })
      groups.push({
        uid: groupUid,
        name: group.name || currentResolved.peopleNames.get(groupUid) || groupUid,
        bots,
      })
    }

    return {
      ready: true,
      peopleCount: currentResolved.humanUids.length,
      botCount,
      groups,
      toggleBot,
    }
  }, [enabled, resolutionKey, resolved, loadError, cancelled, retry, toggleBot])

  return { snapshot, readLatestSelectedBotUids, readLatestHumanUids }
}

/** Selected (non-cancelled) Bot uids from a READY snapshot — the set the grant actually adds.
 *  A loading (not-ready) or absent snapshot yields none, so a stale/in-flight resolve carries zero. */
export function selectedBotUids(snapshot: ForwardBotSnapshot | undefined): string[] {
  if (!snapshot || !snapshot.ready) return []
  const out: string[] = []
  for (const g of snapshot.groups) for (const b of g.bots) if (b.selected) out.push(b.uid)
  return [...new Set(out)]
}
