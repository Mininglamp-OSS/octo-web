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
import WKApp from "../../App"
import { ForwardModal } from "../ForwardModal/ForwardModal"
import { useForwardModal } from "../ForwardModal/useForwardModal"
import {
  useForwardTargetMemberCount,
  useForwardBotSnapshot,
} from "../ForwardModal/hooks"
import type { ForwardFinished, ForwardGrantConfig, ForwardGrantRole } from "../ForwardModal/grant"

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
    confirm: confirmForward,
    requestChannelInfoIfNeeded,
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
    setGrantBotUids,
  } = useForwardModal(
    onFinished,
    grant ? { canGrant: grant.canGrant, defaultRole: grant.defaultRole } : undefined
  )

  // 授权区「将授权给群当前 N 名成员」提示：取真实群成员数（去重 uid），
  // 无群目标时为 undefined（个人转发不显示）。
  const targetMemberCount = useForwardTargetMemberCount(selectedIDs, selectedChannels)

  // 授权区 Bot 展开器（feature: user+Bot grants）：把选中人员创建的 Bot 按人归组，
  // 默认全选、逐个可取消；仅当授权开关开启且确有 Bot 时渲染。失败/无 Bot 时为空快照。
  const resolveName = React.useCallback(
    (uid: string) => allItems.find((it) => it.channelID === uid)?.displayName || uid,
    [allItems],
  )
  // The hook owns the confirm-time getter: readLatestSelectedBotUids() reads the freshest selected
  // Bot set (ref-backed, no render-phase write, no passive-effect race). confirm() layers it into
  // the grant payload before delegating.
  const { snapshot: botSnapshot, readLatestSelectedBotUids } = useForwardBotSnapshot(
    selectedIDs,
    selectedChannels,
    grant ? WKApp.shared.currentSpaceId ?? undefined : undefined,
    !!grant && grantEnabled,
    resolveName,
  )

  const confirm = React.useCallback(() => {
    if (grantEnabled && botSnapshot && !botSnapshot.ready) return
    setGrantBotUids(readLatestSelectedBotUids())
    confirmForward()
  }, [grantEnabled, botSnapshot, setGrantBotUids, readLatestSelectedBotUids, confirmForward])

  const grantConfig: ForwardGrantConfig | undefined = grant
    ? {
        canGrant: grant.canGrant,
        disabledReason: grant.disabledReason,
        enabled: grantEnabled,
        role: grantRole,
        onEnabledChange: setGrantEnabled,
        onRoleChange: setGrantRole,
        targetMemberCount,
        bots: botSnapshot,
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
