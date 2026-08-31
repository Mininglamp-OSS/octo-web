import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import type { ImSubscriberLike } from "../../../im-runtime/channelRuntime"
import {
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
  getCurrentImChannelSubscribers,
  getPendingCurrentImChannelInfoFetch,
  syncCurrentImChannelSubscribers,
} from "../../../im-runtime/currentChannelRuntime"
import SpaceBotService from "../../../Service/SpaceBotService"
import { stripSpacePrefix } from "../../../Service/SpacePrefix"
import { subscriberDisplayName } from "../../../Utils/displayName"
import { mentionUidStateFromRobot } from "../../../Utils/mentionRender"
import type {
  ForwardBotCreatorGroup,
  ForwardBotSnapshot,
  ForwardGrantTargetPrincipals,
} from "../grant"
import { forwardChannelKey } from "../logic/forwardItemKey"
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
  botGroups: Map<
    string,
    {
      lookupUid: string
      name: string
      bots: Array<{ uid: string; name: string }>
    }
  >
  principalsByTarget: Array<{
    channelID: string
    channelType: number
    humanUids: string[]
    botUids: string[]
  }>
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
  /** Final grant principals, retaining the selected target that contributed each uid. */
  readLatestPrincipalsByTarget: () => ForwardGrantTargetPrincipals[]
}

/** Compute the selected (non-cancelled) Bot uids from a resolved model. */
function selectedFrom(resolved: ResolvedModel | null, cancelled: Set<string>): string[] {
  if (!resolved) return []
  const out: string[] = []
  for (const group of resolved.botGroups.values())
    for (const b of group.bots) if (!cancelled.has(b.uid)) out.push(b.uid)
  return [...new Set(out)]
}

/** Apply the current Bot cancellations without losing each principal's target provenance. */
function principalsByTargetFrom(
  resolved: ResolvedModel | null,
  cancelled: Set<string>
): ForwardGrantTargetPrincipals[] {
  if (!resolved) return []
  return resolved.principalsByTarget.map((target) => ({
    channelID: target.channelID,
    channelType: target.channelType,
    uids: [
      ...new Set([...target.humanUids, ...target.botUids.filter((uid) => !cancelled.has(uid))]),
    ],
  }))
}

/**
 * 授权区 Bot 展开器的数据 hook（feature: user+Bot grants）。
 *
 * 把选中目标解析成去重的真人与 Bot：群聊只纳入群内实际成员，直接选中的真人还会按
 * `creator_uid` 带出其 Space Bot。Bot 优先按创建者分组，缺少创建者信息时按来源群兜底；默认全选
 * 且可逐个取消。roster/identity lookup 失败则 fail-closed，显示可重试错误并阻止确认。
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
  resolveName?: ForwardNameResolver
): UseForwardBotSnapshotResult {
  const selectedKey = useMemo(() => selectedIDs.join(","), [selectedIDs])
  const resolvedKey = useMemo(
    () => selectedChannels.map((ch) => `${ch.channelID}:${ch.channelType}`).join(","),
    [selectedChannels]
  )
  // Resolved model from the async pass. `null` = still loading (or gated off). `resolutionKey`
  // synchronously hides a stale model during render; the effect then clears the stored value.
  const [resolved, setResolved] = useState<ResolvedModel | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const resolutionKey = useMemo(
    () => JSON.stringify([selectedKey, resolvedKey, spaceId ?? null, retryGeneration]),
    [selectedKey, resolvedKey, spaceId, retryGeneration]
  )
  // Bot uids the user has CANCELLED (default is "all selected", so we track the negatives).
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set())
  // Monotonic run id: only the newest run may commit, so an in-flight fetch for a superseded
  // target/space never overwrites a fresher one (stale guard without relying on cleanup timing).
  const generation = useRef(0)

  // Confirm-time mirror of {resolved, cancelled}, updated ONLY in commit/event phases below. The
  // stable confirm getters read it directly — never written during render.
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
      // 1) Resolve the selected channel topology once. Each target keeps its own principal sets so
      // WKBase can later discard a target that has become non-sendable without losing provenance.
      const targetPrincipals = selectedChannels.map((channel) => ({
        channelID: channel.channelID,
        channelType: channel.channelType,
        humanUids: new Set<string>(),
        botUids: new Set<string>(),
      }))
      const targetsByKey = new Map(
        targetPrincipals.map((target) => [forwardChannelKey(target), target])
      )
      const directTargets: Array<{
        channel: Channel
        target: (typeof targetPrincipals)[number]
      }> = []
      const peopleNames = new Map<string, string>()
      const groupSnapshots: Array<{
        channel: Channel
        target: (typeof targetPrincipals)[number]
        subscribers: ForwardSubscriberLike[]
      }> = []
      for (const channel of selectedChannels) {
        const target = targetsByKey.get(forwardChannelKey(channel))
        if (!target) continue
        if (channel.channelType === ChannelTypePerson) {
          if (channel.channelID) directTargets.push({ channel, target })
          continue
        }
        try {
          await syncCurrentImChannelSubscribers(channel)
        } catch {
          if (generation.current === gen) setLoadError(true)
          return
        }
        if (generation.current !== gen) return
        const subscribers = getCurrentImChannelSubscribers<Channel, ImSubscriberLike>(channel)
        groupSnapshots.push({ channel, target, subscribers })
      }

      // 2) Fetch the Space Bot catalog. It is a fallback identity source and the source for Bots
      // owned by a DIRECTLY selected person; it is not a count of Bots present in a selected group.
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
      // A positive Bot signal is authoritative across every selected source, not merely inside one
      // group partition. `seenBotUids` is deliberately separate and only de-duplicates UI rows.
      const authoritativeBotUids = new Set(knownBotUids)
      const classifiedHumanUids = new Set<string>()
      const botGroups = new Map<
        string,
        {
          lookupUid: string
          name: string
          bots: Array<{ uid: string; name: string }>
        }
      >()
      const seenBotUids = new Set<string>()
      const addDisplayedBot = (
        groupKey: string,
        lookupUid: string,
        groupName: string,
        bot: { uid: string; name: string }
      ) => {
        if (seenBotUids.has(bot.uid)) return
        seenBotUids.add(bot.uid)
        const existing = botGroups.get(groupKey)
        if (existing) existing.bots.push(bot)
        else botGroups.set(groupKey, { lookupUid, name: groupName, bots: [bot] })
      }

      const readPersonIdentity = async (channel: Channel) => {
        let channelInfo = getCurrentImChannelInfo(channel)
        let identity = mentionUidStateFromRobot(channelInfo?.orgData?.robot)
        const pendingFetch = getPendingCurrentImChannelInfoFetch(channel)
        if (identity === "unknown" && pendingFetch) {
          await pendingFetch
          channelInfo = getCurrentImChannelInfo(channel)
          identity = mentionUidStateFromRobot(channelInfo?.orgData?.robot)
        }
        if (identity === "unknown") {
          const fetched = await fetchCurrentImChannelInfo(channel)
          if (fetched && typeof fetched === "object") channelInfo = fetched
          else channelInfo = getCurrentImChannelInfo(channel)
          identity = mentionUidStateFromRobot(channelInfo?.orgData?.robot)
        }
        return { channelInfo, identity }
      }

      // 3) Resolve direct identities concurrently. Person channel ids can carry a Space prefix;
      // keep the raw id for the SDK/cache key but use the bare uid for Bot lookup and grants.
      let directIdentities: Array<{
        channel: Channel
        target: (typeof targetPrincipals)[number]
        uid: string
        rosterBot: (typeof bots)[number] | undefined
        channelInfo: Awaited<ReturnType<typeof readPersonIdentity>>["channelInfo"]
        identity: Awaited<ReturnType<typeof readPersonIdentity>>["identity"]
      }>
      try {
        directIdentities = await Promise.all(
          directTargets.map(async ({ channel, target }) => {
            const uid = stripSpacePrefix(channel.channelID)
            const rosterBot = botByUid.get(uid)
            if (rosterBot) {
              return {
                channel,
                target,
                uid,
                rosterBot,
                channelInfo: getCurrentImChannelInfo(channel),
                identity: "bot" as const,
              }
            }
            const { channelInfo, identity } = await readPersonIdentity(channel)
            return { channel, target, uid, rosterBot, channelInfo, identity }
          })
        )
      } catch {
        if (generation.current === gen) setLoadError(true)
        return
      }
      if (generation.current !== gen) return

      const resolvedIdentityByUid = new Map<
        string,
        Awaited<ReturnType<typeof readPersonIdentity>>
      >()
      for (const { channel, target, uid, rosterBot, channelInfo, identity } of directIdentities) {
        resolvedIdentityByUid.set(uid, { channelInfo, identity })
        if (identity === "user") {
          classifiedHumanUids.add(uid)
          target.humanUids.add(uid)
          const name = resolveName?.(channel.channelID) || channelInfo?.title || uid
          if (name) peopleNames.set(uid, name)
          continue
        }
        if (identity === "unknown") continue
        authoritativeBotUids.add(uid)
        target.botUids.add(uid)
        const name =
          rosterBot?.name || resolveName?.(channel.channelID) || channelInfo?.title || uid
        addDisplayedBot(`direct:${uid}`, channel.channelID, name, {
          uid,
          name,
        })
      }

      // 4) Classify group members. Missing subscriber metadata gets one concurrent person-channel
      // lookup before the grant-critical snapshot fails closed.
      const partitionedGroups = groupSnapshots.map((snapshot) => ({
        ...snapshot,
        partitioned: partitionForwardSubscribers(snapshot.subscribers, knownBotUids),
      }))
      const unknownUids = new Set<string>()
      for (const { partitioned } of partitionedGroups)
        for (const member of partitioned.unknown) if (member.uid) unknownUids.add(member.uid)

      const fallbackIdentity = new Map<string, Awaited<ReturnType<typeof readPersonIdentity>>>()
      try {
        await Promise.all(
          [...unknownUids].map(async (uid) => {
            const directIdentity = resolvedIdentityByUid.get(uid)
            const identity =
              directIdentity && directIdentity.identity !== "unknown"
                ? directIdentity
                : await readPersonIdentity(new Channel(uid, ChannelTypePerson))
            fallbackIdentity.set(uid, identity)
          })
        )
      } catch {
        if (generation.current === gen) setLoadError(true)
        return
      }
      if (generation.current !== gen) return

      for (const { partitioned } of partitionedGroups) {
        for (const member of partitioned.humans) classifiedHumanUids.add(member.uid!)
        for (const member of partitioned.bots) authoritativeBotUids.add(member.uid!)
      }
      for (const [uid, { identity }] of fallbackIdentity) {
        if (identity === "bot") authoritativeBotUids.add(uid)
        else if (identity === "user") classifiedHumanUids.add(uid)
      }
      for (const uid of unknownUids) {
        if (authoritativeBotUids.has(uid) || classifiedHumanUids.has(uid)) continue
        setLoadError(true)
        return
      }

      for (const { channel, target, partitioned } of partitionedGroups) {
        const humanMembers = [...partitioned.humans]
        const botMembers = [...partitioned.bots]
        for (const member of partitioned.unknown) {
          const uid = member.uid!
          if (authoritativeBotUids.has(uid)) botMembers.push(member)
          else if (classifiedHumanUids.has(uid)) humanMembers.push(member)
        }

        for (const member of humanMembers) {
          const uid = member.uid!
          classifiedHumanUids.add(uid)
          target.humanUids.add(uid)
          const fallbackName = fallbackIdentity.get(uid)?.channelInfo?.title
          const name =
            subscriberDisplayName({
              name: member.name,
              remark: member.remark,
              orgData: member.orgData,
            }).trim() || fallbackName
          if (name && !peopleNames.has(uid)) peopleNames.set(uid, name)
        }

        for (const member of botMembers) {
          const uid = member.uid!
          authoritativeBotUids.add(uid)
          target.botUids.add(uid)
          const rosterBot = botByUid.get(uid)
          const creatorUid = rosterBot?.creator_uid
          const fallbackName = fallbackIdentity.get(uid)?.channelInfo?.title
          const memberName = subscriberDisplayName({
            name: member.name,
            remark: member.remark,
            orgData: member.orgData,
          }).trim()
          addDisplayedBot(
            creatorUid || `group:${channel.channelID}`,
            creatorUid || channel.channelID,
            (creatorUid && peopleNames.get(creatorUid)) || creatorUid || channel.channelID,
            {
              uid,
              name: rosterBot?.name || memberName || fallbackName || uid,
            }
          )
        }
      }

      // A direct lookup can be inconclusive while another selected source has authoritative
      // metadata for the same uid. Defer failure until every source has had a chance to classify it.
      for (const { channel, target, uid, channelInfo, identity } of directIdentities) {
        if (identity !== "unknown") continue
        const name = resolveName?.(channel.channelID) || channelInfo?.title || uid
        if (authoritativeBotUids.has(uid)) {
          target.botUids.add(uid)
          addDisplayedBot(`direct:${uid}`, channel.channelID, name, { uid, name })
          continue
        }
        if (classifiedHumanUids.has(uid)) {
          target.humanUids.add(uid)
          if (name) peopleNames.set(uid, name)
          continue
        }
        setLoadError(true)
        return
      }

      // Reconcile once across all selected sources. If any source knows a uid is a Bot, every target
      // occurrence is moved from the human set to the Bot set, preserving that target's provenance.
      for (const target of targetPrincipals) {
        for (const uid of target.humanUids) {
          if (!authoritativeBotUids.has(uid)) continue
          target.humanUids.delete(uid)
          target.botUids.add(uid)
        }
      }

      // 5) Preserve "selected person + their Space Bots" only for a directly selected target that
      // remains globally classified as human. Record every source before de-duplicating display rows.
      const directHumanTargets = new Map<
        string,
        Array<{ target: (typeof targetPrincipals)[number]; lookupUid: string }>
      >()
      for (const { channel, uid, target } of directIdentities) {
        if (!target.humanUids.has(uid)) continue
        const targets = directHumanTargets.get(uid) ?? []
        targets.push({ target, lookupUid: channel.channelID })
        directHumanTargets.set(uid, targets)
      }
      for (const bot of bots) {
        if (!bot?.uid || !bot.creator_uid) continue
        const creatorTargets = directHumanTargets.get(bot.creator_uid)
        if (!creatorTargets) continue
        for (const { target } of creatorTargets) target.botUids.add(bot.uid)
        addDisplayedBot(
          bot.creator_uid,
          creatorTargets[0].lookupUid,
          peopleNames.get(bot.creator_uid) || bot.creator_uid,
          { uid: bot.uid, name: bot.name || bot.uid }
        )
      }

      const humanUids = new Set<string>()
      for (const target of targetPrincipals) for (const uid of target.humanUids) humanUids.add(uid)

      commit({
        key: resolutionKey,
        humanUids: [...humanUids],
        peopleNames,
        botGroups,
        principalsByTarget: targetPrincipals.map((target) => ({
          channelID: target.channelID,
          channelType: target.channelType,
          humanUids: [...target.humanUids],
          botUids: [...target.botUids],
        })),
      })
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

  const readLatestPrincipalsByTarget = useCallback((): ForwardGrantTargetPrincipals[] => {
    if (!enabled || !spaceId) return []
    const current = resolvedRef.current
    if (current?.key !== resolutionKey) return []
    return principalsByTargetFrom(current, cancelledRef.current)
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
        name:
          resolveName?.(group.lookupUid) ||
          currentResolved.peopleNames.get(group.lookupUid) ||
          group.name ||
          groupUid,
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
  }, [enabled, resolutionKey, resolved, loadError, cancelled, resolveName, retry, toggleBot])

  return {
    snapshot,
    readLatestSelectedBotUids,
    readLatestHumanUids,
    readLatestPrincipalsByTarget,
  }
}

/** Selected (non-cancelled) Bot uids from a READY snapshot — the set the grant actually adds.
 *  A loading (not-ready) or absent snapshot yields none, so a stale/in-flight resolve carries zero. */
export function selectedBotUids(snapshot: ForwardBotSnapshot | undefined): string[] {
  if (!snapshot || !snapshot.ready) return []
  const out: string[] = []
  for (const g of snapshot.groups) for (const b of g.bots) if (b.selected) out.push(b.uid)
  return [...new Set(out)]
}
