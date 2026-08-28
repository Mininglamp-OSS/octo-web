import { useEffect, useMemo, useState } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import type { ImSubscriberLike } from "../../../im-runtime/channelRuntime"
import {
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../../im-runtime/currentChannelRuntime"

/**
 * 授权区「将授权给群当前 N 名成员」提示的成员数。
 *
 * 语义：与 host 侧 collectForwardUids 一致地把选中目标展开成去重 uid 快照
 * （群 → syncSubscribes/getSubscribes 成员，个人 → 对端 uid），使提示数与
 * 实际会被授权的成员数吻合。无群目标时返回 undefined（个人转发不显示）。
 *
 * stale guard：选中项在异步 syncSubscribes 期间变化时，丢弃过期结果，
 * 避免旧一批成员数覆盖当前选择的计数。
 */
export function useForwardTargetMemberCount(
  selectedIDs: string[],
  selectedChannels: Channel[],
): number | undefined {
  // 选择语义以 selectedIDs 为准；resolvedKey 用来感知 channelMap 补齐后的重算时机。
  // useMemo 化避免每次渲染都执行 .join(',') 与 .map(...).join(',')。
  const selectedKey = useMemo(() => selectedIDs.join(","), [selectedIDs])
  const resolvedKey = useMemo(
    () => selectedChannels.map((ch) => `${ch.channelID}:${ch.channelType}`).join(","),
    [selectedChannels],
  )
  const [count, setCount] = useState<number | undefined>(undefined)

  useEffect(() => {
    // 选中项里仍有未登记到 channelMap 的目标时，不用部分 resolved channel
    // 先算一个偏小快照；等待 channel 信息补齐后再计算完整成员数。
    if (selectedChannels.length !== selectedIDs.length) {
      setCount(undefined)
      return
    }

    const groups = selectedChannels.filter((ch) => ch.channelType !== ChannelTypePerson)
    if (groups.length === 0) {
      setCount(undefined)
      return
    }
    const persons = selectedChannels.filter((ch) => ch.channelType === ChannelTypePerson)
    let cancelled = false
    const compute = async () => {
      const uids = new Set<string>()
      for (const ch of persons) {
        if (ch.channelID) uids.add(ch.channelID)
      }
      for (const ch of groups) {
        try {
          await syncCurrentImChannelSubscribers(ch)
        } catch {
          // best-effort：拉取失败时退回已缓存的成员快照。
        }
        if (cancelled) return
        const subs = getCurrentImChannelSubscribers<Channel, ImSubscriberLike>(ch)
        for (const s of subs) {
          if (typeof s?.uid === "string" && s.uid) uids.add(s.uid)
        }
      }
      if (!cancelled) setCount(uids.size > 0 ? uids.size : undefined)
    }
    void compute()
    return () => {
      cancelled = true
    }
    // selectedKey 承载「选中了哪些 id」的语义；resolvedKey 只用于感知这些 id 对应的
    // Channel 何时补齐或类型变化，避免 selectedChannels 新数组引用导致重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, resolvedKey])

  return count
}
