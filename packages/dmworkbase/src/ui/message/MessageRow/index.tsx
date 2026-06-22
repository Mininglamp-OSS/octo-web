import React from 'react'
import classNames from 'classnames'
import Avatar from '../Avatar'
import Timestamp from '../Timestamp'
import AiBadge from '../../../Components/AiBadge'
import WebhookBadge from '../../../Components/WebhookBadge'
import RealnameVerifiedBadge from '../../../Components/RealnameVerifiedBadge'
import { useI18n } from '../../../i18n'
import './index.css'

export interface MessageRowProps {
  /** 是否为发送方消息（控制布局方向） */
  isSend: boolean
  
  /** 是否为连续消息（同一发送者的连续消息，头像占位但隐藏） */
  isContinue: boolean
  
  /** 是否被选中（多选模式） */
  isSelected: boolean
  
  /** 是否显示头像 */
  showAvatar: boolean
  
  /** 头像 URL */
  avatarUrl: string
  
  /** 发送者名称 */
  senderName: string

  /** 时间戳（格式化后的字符串） */
  timestamp: string

  /** 仅时间部分（HH:mm），连续消息 hover 时显示 */
  timeOnly?: string

  /** 发送者是否在线（可选） */
  isOnline?: boolean
  /** 消息是否被编辑过（显示「已编辑」标签） */
  isEdit?: boolean

  /**
   * 相对当前查看 Space，发送者是否来自外部 Space。
   * bridge 层计算；为 true 且 `sourceSpaceName` 非空时，在发送者名称后
   * 渲染 `@{sourceSpaceName}` 后缀，与新组件 `wk-msg-head-space` 行为一致。
   */
  isExternal?: boolean

  /**
   * 外部来源 Space 名称（相对当前查看 Space 解析后）。
   */
  sourceSpaceName?: string

  /**
   * 发送者是否已完成 OCTO 实名认证（Epic dmwork-web#1169 Phase A）。
   * 为 true 时在发送者名右侧紧贴渲染 `<RealnameVerifiedBadge variant="icon" />`
   * 迷你蓝色 ✓ 圆点。未实名一律不渲染（不加灰色 badge / 警告标）。
   */
  isRealnameVerified?: boolean
  
  /** 选择状态变化回调 */
  onSelect?: (selected: boolean) => void
  
  /** 消息内容（子组件） */
  children: React.ReactNode
  
  /** 是否显示多选 Checkbox */
  showCheckbox?: boolean

  /** 会话是否处于多选模式（即使当前消息不可选） */
  selectionMode?: boolean
  
  /** 右键菜单事件 */
  onContextMenu?: (event: React.MouseEvent) => void

  /** 行点击事件（多选模式整行可点） */
  onClick?: () => void

  /** 右键菜单打开时保持 hover 高亮 */
  isActive?: boolean

  /** 头像点击回调（私聊场景：点头像打开私聊） */
  onAvatarClick?: (e: React.MouseEvent) => void

  /** 发送者名称点击回调（@ 场景：点名字展示用户信息） */
  onSenderNameClick?: () => void

  /** 发送者是否为 bot（AI），名称后显示 AI 标识 */
  isBot?: boolean

  /** 发送者是否为群入站 Webhook，名称后显示 Webhook 标识 */
  isWebhook?: boolean
}

/**
 * 消息行容器组件
 * 
 * @description 控制消息的整体布局、头像、时间戳、hover 态等
 * 
 * 布局规则：
 * - 接收方消息：头像在左，内容在右
 * - 发送方消息：内容在左，头像在右（头像可选）
 * - 连续消息：头像占位但隐藏（visibility: hidden）
 * - Hover 时：背景色 rgba(28,28,35,0.04)
 */
export default function MessageRow({
  isSend,
  isContinue,
  isSelected,
  showAvatar,
  avatarUrl,
  senderName,
  isBot,
  isWebhook,
  timestamp,
  timeOnly,
  isOnline,
  isEdit,
  isExternal,
  sourceSpaceName,
  isRealnameVerified,
  onSelect,
  children,
  showCheckbox = false,
  selectionMode = false,
  onContextMenu,
  onClick,
  isActive,
  onAvatarClick,
  onSenderNameClick,
}: MessageRowProps) {
  const { t } = useI18n()
  const isSelecting = selectionMode || showCheckbox
  const handleRowClick = isSelecting || onClick
    ? () => {
        if (isSelecting) {
          if (showCheckbox) {
            onSelect?.(!isSelected)
          }
          return
        }
        onClick?.()
      }
    : undefined
  const handleContextMenu = (event: React.MouseEvent) => {
    if (isSelecting) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onContextMenu?.(event)
  }

  return (
    <div
      className={classNames(
        'wk-msg-row',
        isSend && 'wk-msg-row--send',
        isContinue && 'wk-msg-row--continue',
        isSelected && 'wk-msg-row--selected',
        showCheckbox && 'wk-msg-row--selecting',
        isSelecting && 'wk-msg-row--selection-mode',
        isActive && 'wk-msg-row--active',
      )}
      onContextMenu={handleContextMenu}
      onClick={handleRowClick}
    >
      {/* 多选 Checkbox */}
      {showCheckbox && (
        <div
          className="wk-msg-row-checkbox"
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(!isSelected)
          }}
        >
          <div className={classNames(
            'wk-msg-row-checkbox-inner',
            isSelected && 'wk-msg-row-checkbox-inner--checked'
          )}>
            {isSelected && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 3.5L3.8 6.5L9 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
      )}
      
      {/* 头像（所有消息都在左侧） */}
      <div className="wk-msg-row-avatar">
        {showAvatar && (
          <Avatar
            src={avatarUrl}
            size={36}
            isOnline={isOnline}
            showOnlineDot
            alt={senderName}
            onClick={isSelecting || isWebhook ? undefined : onAvatarClick}
          />
        )}
        {/* 连续消息：头像占位,hover 时显示时间戳 */}
        {!showAvatar && isContinue && (
          <div className="wk-msg-row-avatar-placeholder">
            {isEdit && <span className="wk-msg-row-edited">{t("base.message.edited")}</span>}
            <span className="wk-msg-row-timestamp-hover">{timeOnly ?? timestamp}</span>
          </div>
        )}
      </div>
      
      {/* 消息内容区 */}
      <div className="wk-msg-row-content">
        {/* 发送者名称 + 时间戳（非连续消息时显示） */}
        {!isContinue && (
          <div className="wk-msg-row-header">
            <span
              className="wk-msg-row-sender"
              style={{ cursor: !isSelecting && !isWebhook && onSenderNameClick ? 'pointer' : undefined }}
              onClick={isSelecting || isWebhook ? undefined : onSenderNameClick}
            >{senderName}</span>
            {/* Epic dmwork-web#1169 Phase A: 实名徽章紧贴作者名右侧，
                只 variant="icon" 迷你形态，已实名才渲染。*/}
            {isRealnameVerified && (
              <RealnameVerifiedBadge variant="icon" />
            )}
            {/*
              发送者名后的 @SpaceName 后缀（企微风格）。
              R1-R6 五轮都改了新组件 wk-msg-head，但真正上屏的是这个老组件
              wk-msg-row-header —— Yu 15:13 console 诊断定位到 fiber 数据对、
              但 DOM 里根本没有 @SpaceName span，即渲染组件缺实现。
              数据层 fallback 由 bridge/useMessageRow 统一调用 resolveExternalForViewer
              计算，UI 只做条件渲染，不再直接依赖 WKApp / WKSDK。
            */}
            {isExternal && sourceSpaceName && (
              <span
                className="wk-msg-row-sender-space"
                title={`@${sourceSpaceName}`}
              >
                @{sourceSpaceName}
              </span>
            )}
            {isBot && <AiBadge size="small" />}
            {isWebhook && <WebhookBadge />}
            {isEdit && <span className="wk-msg-row-edited">{t("base.message.edited")}</span>}
            <span className="wk-msg-row-timestamp">{timestamp}</span>
          </div>
        )}
        
        {/* 消息体 */}
        <div className="wk-msg-row-body">
          {children}
        </div>
      </div>
    </div>
  )
}
