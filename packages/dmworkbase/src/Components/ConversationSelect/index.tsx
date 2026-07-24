/**
 * ConversationSelect
 *
 * 对外接口保持兼容（onFinished / title），内部由 ForwardModal + useForwardModal 实现。
 * 原有调用方（WKBase、Conversation/index.tsx、Chat/index.tsx）零改动。
 *
 * feature #511：新增可选 `grant` 配置。仅当传入时渲染授权区并把授权选择带回 onFinished 的第二参；
 * 不传 → 行为与之前完全一致。
 */
import React from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import { ForwardModal } from "../ForwardModal/ForwardModal"
import { useForwardModal } from "../ForwardModal/useForwardModal"
import type { ForwardFinished, ForwardGrantConfig, ForwardGrantRole } from "../ForwardModal/grant"
import {
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime"

export interface ConversationSelectGrant {
  canGrant: boolean
  disabledReason?: string
  defaultRole?: ForwardGrantRole
}

interface ConversationSelectProps {
  onFinished?: ForwardFinished
  onCancel?: () => void
  title?: string
  /** 授权区 opt-in 配置（feature #511）。不传则不渲染授权区。 */
  grant?: ConversationSelectGrant
}

export default function ConversationSelect({
  onFinished,
  onCancel,
  title,
  grant,
}: ConversationSelectProps) {
  const {
    items,
    allItems,
    selectedIDs,
    selectedChannels,
    inputValue,
    loading,
    activeTab,
    setActiveTab,
    setInputValue,
    toggleSelect,
    confirm,
    requestChannelInfoIfNeeded,
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
  } = useForwardModal(
    onFinished,
    grant ? { canGrant: grant.canGrant, defaultRole: grant.defaultRole } : undefined
  )

  // "将授权给群当前 N 名成员" 提示：取真实群成员数，而非选中目标数。
  // 与 host 侧 collectForwardUids 一致地把选中目标展开成去重 uid 快照
  // （群 → syncSubscribes/getSubscribes 成员，个人 → 对端 uid），使提示数
  // 与实际会被授权的成员数吻合；无群目标时不提示（个人转发不显示）。
  const selectedKey = selectedIDs.join(",")
  const [targetMemberCount, setTargetMemberCount] = React.useState<number | undefined>(undefined)

  React.useEffect(() => {
    const groups = selectedChannels.filter((ch) => ch.channelType !== ChannelTypePerson)
    if (groups.length === 0) {
      setTargetMemberCount(undefined)
      return
    }
    const persons = selectedChannels.filter((ch) => ch.channelType === ChannelTypePerson)
    // stale guard：选中项在异步 syncSubscribes 期间变化时，丢弃过期结果，
    // 避免旧一批成员数覆盖当前选择的计数。
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
        const subs = getCurrentImChannelSubscribers(ch) as { uid?: string }[]
        for (const s of subs) {
          if (s?.uid) uids.add(s.uid)
        }
      }
      if (!cancelled) setTargetMemberCount(uids.size > 0 ? uids.size : undefined)
    }
    void compute()
    return () => {
      cancelled = true
    }
    // selectedKey 是 selectedIDs 的稳定字符串键（selectedChannels 每次渲染重建，
    // 不能直接做依赖，否则会无限触发）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const grantConfig: ForwardGrantConfig | undefined = grant
    ? {
        canGrant: grant.canGrant,
        disabledReason: grant.disabledReason,
        enabled: grantEnabled,
        role: grantRole,
        onEnabledChange: setGrantEnabled,
        onRoleChange: setGrantRole,
        targetMemberCount,
      }
    : undefined

  return (
    <ForwardModal
      title={title}
      items={items}
      allItems={allItems}
      selectedIDs={selectedIDs}
      inputValue={inputValue}
      loading={loading}
      onInputChange={setInputValue}
      onToggleSelect={toggleSelect}
      onConfirm={confirm}
      onCancel={onCancel}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onItemVisible={requestChannelInfoIfNeeded}
      grant={grantConfig}
    />
  )
}
