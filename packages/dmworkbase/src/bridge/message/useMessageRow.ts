import React, { useCallback, useEffect, useState } from 'react'
import WKSDK, { Channel, ChannelTypePerson, ChannelTypeGroup } from 'wukongimjssdk'
import type { ChannelInfo, ChannelInfoListener } from 'wukongimjssdk'
import WKApp from '../../App'
import type { MessageWrap } from '../../Service/Model'
import type { MessageRowUIProps } from './types'
import { resolveExternalForViewer } from '../../Utils/externalViewer'
import { personalRemarkDisplayName, subscriberDisplayName } from '../../Utils/displayName'
import { shouldShowRealnameBadge } from '../../Utils/realnameBadge'
import {
  isIncomingWebhookSender,
  resolveWebhookRowDisplay,
  webhookFromOfMessage,
} from '../../Service/IncomingWebhook'
import moment from 'moment'
import { isMessageContinuation } from '../../Service/messageContinuity'
import { formatMessageTimestamp } from '../../Utils/time'
import {
  addImChannelInfoListener,
  addImSubscriberChangeListener,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelSubscribers,
} from '../../im-runtime/channelRuntime'

export interface MessageRowSelectionState {
  /** 当前会话是否处于多选模式（不可选消息也需要知道，用于禁用行内操作） */
  selectionMode?: boolean
  /** 当前消息是否显示多选 Checkbox */
  showCheckbox: boolean
  /** 当前消息是否被选中（来自 message.checked） */
  isSelected: boolean
  /** 点击 checkbox 时的回调（来自 context.checkeMessage） */
  onSelect?: (selected: boolean) => void
}

export interface MessageRowInteractionState {
  /** 头像点击回调（私聊场景：点头像打开私聊，传入 fromUID） */
  onAvatarClick?: (uid: string, e: React.MouseEvent) => void
  /** 发送者名称点击回调（@ 场景：点名字展示用户信息，传入 fromUID） */
  onSenderNameClick?: (uid: string) => void
}

/**
 * 从 channelInfo 取优先级最高的展示名
 * 优先级：备注名(displayName) > title > 空
 * 注意：channelInfo 未缓存时返回空串，避免把 32 位 fromUID 当名字暴露在 UI。
 * fetchChannelInfo 回包后 listener 会触发重渲染补上真名。
 */
function getSenderName(channelInfo: ChannelInfo | undefined, fromUID: string): string {
  return channelInfo?.orgData?.displayName || channelInfo?.title || ''
}

/**
 * 合并后的群成员查找：一次遍历 subscribers 同时返回 member 对象和展示名。
 *
 * 原先 `getGroupMemberName` 与 `getGroupMember` 会对同一个
 * subscribers 数组做两次 `.find()`（O(2n)），在大群（1000+ 成员）每条
 * 消息都会重复扫表。此函数合并成单次查找，调用方按需解构。
 *
 * 返回：
 *   - `member`: 命中的群成员对象（未命中 / 非群消息为 undefined）
 *   - `memberName`: `subscriberDisplayName(member)` 的结果；未命中返回 ''
 *
 * 调用方约定：非群消息 / 缓存未到达 → member=undefined, memberName=''，
 * 调用方应继续降级到 Person channelInfo。
 */
function getGroupMemberInfo(message: MessageWrap): { member: any | undefined; memberName: string } {
  if (message.channel?.channelType !== ChannelTypeGroup || !message.fromUID) {
    return { member: undefined, memberName: '' }
  }
  try {
    const subs = getImChannelSubscribers(WKSDK.shared(), message.channel) as any[]
    const member = subs.find((s) => s && s.uid === message.fromUID)
    return { member, memberName: subscriberDisplayName(member) }
  } catch {
    return { member: undefined, memberName: '' }
  }
}

/**
 * getMessageRow - 纯函数版本（不含异步/监听逻辑）
 *
 * @description 从 MessageWrap 提取 MessageRow 组件需要的 UI 数据（不使用 hooks）
 *
 * @param message - 业务消息对象
 * @param selection - 多选状态（从 context 传入）
 * @returns MessageRow 组件的 Props
 */
export function getMessageRow(
  message: MessageWrap,
  selection?: MessageRowSelectionState,
  interaction?: MessageRowInteractionState
): Omit<MessageRowUIProps, 'children'> {
  const channelInfo = getImChannelInfo(
    WKSDK.shared(),
    new Channel(message.fromUID, ChannelTypePerson)
  )

  // 群入站 Webhook 消息（FromUID = iwh_*，永远不是群成员）：
  // 名称/头像读 payload 的 from 元信息，不走群成员 / Person ChannelInfo
  // 解析（必落空），也不提供头像/名称点击（无个人资料页）。
  const webhookFrom = webhookFromOfMessage(message)

  // 判断是否为连续消息（对齐 Model.tsx preIsSamePerson 逻辑）
  // 时间分隔符或撤回消息之后不算连续
  const isContinue = isMessageContinuation(message.preMessage, message)

  // 格式化时间戳
  const timestamp = formatMessageTimestamp(message.timestamp)
  const timeOnly = formatTimeOnly(message.timestamp)

  if (webhookFrom) {
    const display = resolveWebhookRowDisplay(webhookFrom)
    return {
      isSend: message.send,
      isContinue,
      isSelected: selection?.isSelected ?? false,
      showCheckbox: selection?.showCheckbox ?? false,
      selectionMode: selection?.selectionMode ?? selection?.showCheckbox ?? false,
      showAvatar: !isContinue,
      // payload 自带头像优先；否则走与普通用户同源的头像链路（avatarUser(uid)）。
      avatarUrl: display.avatarUrl || WKApp.shared.avatarUser(message.fromUID),
      // payload.from 缺失的异常路径返回空串，不把 iwh_* 暴露到 UI
      senderName: display.senderName,
      isBot: false,
      // 徽章跟随 display.showBadge。isWebhook 仅驱动 MessageRow 的「机器人」徽章。
      isWebhook: display.showBadge,
      timestamp,
      timeOnly,
      isEdit: message.message?.remoteExtra?.isEdit ?? false,
      isExternal: false,
      isRealnameVerified: false,
      onSelect: selection?.onSelect,
    }
  }

  // 把 uid 绑定到回调
  const uid = message.fromUID
  const onAvatarClick = interaction?.onAvatarClick
    ? (e: React.MouseEvent) => interaction.onAvatarClick!(uid, e)
    : undefined
  const onSenderNameClick = interaction?.onSenderNameClick
    ? () => interaction.onSenderNameClick!(uid)
    : undefined

  // 外部成员来源 Space 后缀（@SpaceName），相对当前查看 Space 解析。
  // 与新组件 wk-msg-head 保持同一套 resolve 规则（msg-level 新字段优先，
  // legacy from_* 降级），群聊时允许用 channelInfo.orgData 做最后兜底。
  const viewerSpaceId = WKApp.shared.currentSpaceId
  const msgRes = resolveExternalForViewer({
    homeSpaceId: message.fromHomeSpaceId,
    homeSpaceName: message.fromHomeSpaceName,
    isExternalLegacy: message.fromIsExternal ? 1 : 0,
    sourceSpaceNameLegacy: message.fromSourceSpaceName,
    viewerSpaceId,
  })
  const hasMsgLevel = !!message.fromHomeSpaceId ||
    (message.fromIsExternal && !!message.fromSourceSpaceName)
  const isGroupMsg = message.channel?.channelType === ChannelTypeGroup
  const orgHomeSpaceId = channelInfo?.orgData?.home_space_id as string | undefined
  const orgHomeSpaceName = channelInfo?.orgData?.home_space_name as string | undefined
  const orgRes = isGroupMsg
    ? resolveExternalForViewer({
        homeSpaceId: orgHomeSpaceId,
        homeSpaceName: orgHomeSpaceName,
        isExternalLegacy: channelInfo?.orgData?.is_external,
        sourceSpaceNameLegacy: channelInfo?.orgData?.source_space_name,
        viewerSpaceId,
      })
    : { isExternal: false, sourceSpaceName: '' }
  const isExternal = hasMsgLevel ? msgRes.isExternal : orgRes.isExternal
  const sourceSpaceName = hasMsgLevel ? msgRes.sourceSpaceName : orgRes.sourceSpaceName

  // 单次群成员查找，同时拿到 memberName 和 member 对象，
  // 避免重复 .find()。
  const { member: groupMember, memberName: groupMemberName } = getGroupMemberInfo(message)
  // 个人备注来自 sender 的 Person channelInfo。群消息虽然主路径读 subscriber，
  // 但用户手动设置的个人备注必须优先于群成员名，否则 friend/remark 保存后
  // fetchChannelInfo 已刷新也会被 subscriber.name 挡住。
  const personalRemarkName = personalRemarkDisplayName(channelInfo)

  // Epic dmwork-web#1169 Phase A: 发送者实名徽章。
  // 优先群成员 orgData（群消息命中率最高），回落 Person channelInfo.orgData
  // （1v1 私聊或群成员列表尚未同步）。AI / 字段缺失一律为 false，未实名不
  // 渲染任何徽章。
  //
  // 自己看自己的消息也显示实名徽章。客户端群成员订阅列表通常不
  // 缓存 "自己" 的条目（WKSDK 优化，self 走 WKApp.loginInfo 路径），且群
  // channelInfo orgData 不带 realname_verified 字段 → 两路 fallback 都拿
  // 不到 → self-viewer 永远看不到自己的 ✓。这里再补一条 self-viewer
  // fallback，对齐 iOS/Android 视觉。
  //
  // Round 3（Jerry R2 Critical）：
  //   "是不是 bot 会话" 必须按 **会话 channel**（`message.channel`，即对方
  //   那一端）判，不能按 **发送者 channel**（`message.fromUID` 的 Person
  //   channelInfo）判。自己在 bot 1v1 里发消息时 fromUID=自己 → 按发送者
  //   查到的是自己的 Person channelInfo（robot≠1） → bot 判断失效 →
  //   self-fallback 把自己发给 bot 的消息错误标成实名 ✓。
  //
  //   独立变量 `isBotConversation` 和 `isBotSender` 分工：
  //     - isBotConversation: 会话对端是 bot（自己 / 别人发都不显示徽章）；
  //     - isBotSender:       群里发送者是 bot（保留 R1 规则，bot 发言不显示）。
  //
  // 注意：
  //   1. bot 优先级不变 —— helper 里 `isBotConversation` + `isBotSender`
  //      依次短路，bot 场景一律不显示徽章。
  //   2. WKApp.loginInfo.realnameVerified 是 boolean | undefined 的 tri-state，
  //      必须显式 === true 判断（Phase A 血泪教训：truthy 会把 undefined
  //      意外放行）。
  //
  // Round 4 (Jerry R3 timing race)：
  //   如果 **conversation channelInfo 首帧未缓存**，isBotConversation 会误判
  //   为 false，self-sent bot DM 首帧就会命中 self-fallback 误显 ✓。纯判定
  //   层面，对 Person 1v1 且 conversationChannelInfo 缺失的 self-sent 场景
  //   采取 **保守策略**：把 isBotConversation 先当作 true 压制 self-fallback，
  //   等 useMessageRow hook 的 message.channel listener 拿到 channelInfo 后
  //   再 rerender 决定真实值。这样不会把「你发给朋友」也压下去（若朋友的
  //   Person channelInfo 已缓存，conversationChannelInfo !== undefined）。
  const conversationChannelInfo = message.channel
    ? getImChannelInfo(WKSDK.shared(), message.channel)
    : undefined
  const isOwnMessage = message.fromUID === WKApp.loginInfo.uid
  const isPersonConversation =
    message.channel?.channelType === ChannelTypePerson
  const conversationChannelInfoMissing =
    isPersonConversation && !conversationChannelInfo
  const isBotConversation =
    conversationChannelInfo?.orgData?.robot === 1 ||
    (conversationChannelInfoMissing && isOwnMessage)
  const isBotSender = channelInfo?.orgData?.robot === 1
  const realnameVerified = shouldShowRealnameBadge({
    isAi: false,
    isBotConversation,
    isBotSender,
    isOwnMessage,
    groupMemberOrgData: groupMember?.orgData,
    channelInfoOrgData: channelInfo?.orgData,
    loginRealnameVerified: WKApp.loginInfo.realnameVerified,
  })

  return {
    isSend: message.send,
    isContinue,
    isSelected: selection?.isSelected ?? false,
    showCheckbox: selection?.showCheckbox ?? false,
    selectionMode: selection?.selectionMode ?? selection?.showCheckbox ?? false,
    showAvatar: !isContinue,
    avatarUrl: WKApp.shared.avatarUser(message.fromUID),
    // self 气泡名字走 loginInfo.selfDisplayName() —— 已实名时
    // 返回 real_name，否则返回 name。self 不在 friend/sync 的 payload 里，
    // groupMember 和 Person channelInfo 都拿不到 real_name，只有登录
    // payload 下发的 loginInfo 是可靠源。规则改动同步 Messages/Base/index.tsx。
    senderName: isOwnMessage
      ? WKApp.loginInfo.selfDisplayName() ||
        personalRemarkName ||
        groupMemberName ||
        getSenderName(channelInfo, message.fromUID)
      : personalRemarkName || groupMemberName || getSenderName(channelInfo, message.fromUID),
    isBot: channelInfo?.orgData?.robot === 1,
    timestamp,
    timeOnly,
    isOnline: channelInfo?.online,
    isEdit: message.message?.remoteExtra?.isEdit ?? false,
    isExternal,
    sourceSpaceName,
    isRealnameVerified: realnameVerified,
    onSelect: selection?.onSelect,
    onAvatarClick,
    onSenderNameClick,
  }
}

/**
 * useMessageRow Hook
 *
 * @description 从 MessageWrap 提取 MessageRow 组件需要的 UI 数据。
 *
 * 修复「发送者名称显示为 uid」问题：
 * - channelInfo 未缓存时，触发 fetchChannelInfo 异步拉取
 * - 注册 channelInfoListener，拉到结果后重新渲染（对齐 Base/index.tsx 的做法）
 * - senderName 优先取 displayName（备注名），其次 title，拿不到时返回空串
 *   （避免把 32 位 fromUID 当名字泄漏到 UI，等 listener 回包后重渲染显示真名）
 *
 * @param message - 业务消息对象
 * @returns MessageRow 组件的 Props
 */
export function useMessageRow(
  message: MessageWrap,
  selection?: MessageRowSelectionState,
  interaction?: MessageRowInteractionState
): Omit<MessageRowUIProps, 'children'> {
  // 用 tick 来触发重渲染（channelInfo 更新后）
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    const fromUID = message.fromUID
    if (!fromUID) return
    // webhook 发送者（iwh_*）不是真实用户：fetchChannelInfo 必落空，
    // 群成员列表里也不存在，跳过所有 fetch / listener
    if (isIncomingWebhookSender(fromUID)) return

    const channel = new Channel(fromUID, ChannelTypePerson)

    // 没有缓存时发起请求
    const cached = getImChannelInfo(WKSDK.shared(), channel)
    if (!cached) {
      void fetchImChannelInfo(WKSDK.shared(), channel)
    }

    // R4（Jerry R3 timing race）：会话对端（message.channel，Person
    // 1v1 时是 bot/friend 的 Person channelInfo）也必须 fetch + listen。
    // 否则 self-sent Person 1v1 首帧 conversationChannelInfo 缺失 → bot DM
    // 误判成非 bot 会话 → self-fallback 亮 ✓（getMessageRow 里已加保守兜底，
    // 这里的 fetch/listen 保证 channelInfo 到达后 rerender 切回真实状态）。
    // Round 6 (Jerry R5 Warning)：收窄 conversation channelInfo fetch/listen 到
    // 仅 Person 1v1。timing race 只发生在 self-sent Person 1v1 + 首帧缓存未到的
    // bot DM 场景，群消息不需要拉 group channelInfo 来判 self fallback。不收窄
    // 会在群聊历史首屏 N 个 row 并发 fetch 同一个 group channel。
    // Round 7 (Jerry R6 Suggestion)：1v1 Person 场景下 sender channel 和
    // conversation channel 是同一个 Person channel（对方）。上方已经 fetch 过 sender
    // channel，不要重复 fetch。用 isEqual dedupe。
    const convChannel = message.channel
    if (
      convChannel &&
      convChannel.channelType === ChannelTypePerson &&
      !convChannel.isEqual(channel)
    ) {
      const convCached = getImChannelInfo(WKSDK.shared(), convChannel)
      if (!convCached) {
        void fetchImChannelInfo(WKSDK.shared(), convChannel)
      }
    }

    // 监听 channelInfo 更新：sender 或 conversation 对端到达时均触发重渲染。
    const listener: ChannelInfoListener = (channelInfo: ChannelInfo) => {
      const ch = channelInfo?.channel
      if (!ch) return
      if (ch.channelID === fromUID) {
        forceUpdate()
        return
      }
      if (
        convChannel &&
        ch.channelID === convChannel.channelID &&
        ch.channelType === convChannel.channelType
      ) {
        forceUpdate()
      }
    }
    const unsubscribeChannelInfo = addImChannelInfoListener(WKSDK.shared(), listener)

    // 群成员到达 / 更新时触发重渲染：群消息发送者名字主路径读群成员列表，
    // 成员列表是异步同步的，消息可能先于成员列表到达，需要通知一次。
    const msgChannel = message.channel
    const subListener = (ch: Channel) => {
      if (msgChannel?.isEqual(ch)) {
        forceUpdate()
      }
    }
    const unsubscribeSubscriberChange = addImSubscriberChangeListener(WKSDK.shared(), subListener)

    return () => {
      unsubscribeChannelInfo()
      unsubscribeSubscriberChange()
    }
  }, [message.fromUID, message.channel, forceUpdate])

  return getMessageRow(message, selection, interaction)
}

/**
 * 只返回 HH:mm，用于连续消息 hover 时显示
 */
function formatTimeOnly(timestamp: number): string {
  const ms = timestamp < 10000000000 ? timestamp * 1000 : timestamp
  return moment(ms).format('HH:mm')
}
