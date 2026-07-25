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
import { ForwardModal } from "../ForwardModal/ForwardModal"
import { useForwardModal } from "../ForwardModal/useForwardModal"
import { useForwardTargetMemberCount } from "../ForwardModal/hooks"
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

  // 授权区「将授权给群当前 N 名成员」提示：取真实群成员数（去重 uid），
  // 无群目标时为 undefined（个人转发不显示）。
  const targetMemberCount = useForwardTargetMemberCount(selectedIDs, selectedChannels)

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
