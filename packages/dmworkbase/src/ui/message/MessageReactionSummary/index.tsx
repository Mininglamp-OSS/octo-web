import classNames from "classnames"
import React from "react"

import "./index.css"
import type { MessageReactionType } from "./types"

export interface MessageReactionChip {
  /** React key，通常传 `${reactionType}-${reactionKey}` */
  key: string
  /**
   * 图标 slot：unicode emoji 时可传 string；`[收到]` token 或 sticker 时传 <img>/<span>。
   * 由 parent 负责解析（emoji manifest / getFileURL），组件只做展示。
   */
  icon: React.ReactNode
  /**
   * 参与者文本 slot：已按 i18n 格式化好的字符串或节点，
   * 例如 "张三、李四、王五等 6 人" / "Alice, Bob and 4 others"。
   */
  text: React.ReactNode
  /** 当前用户是否参与过（决定高亮态）。 */
  hasMine: boolean
  /** 点击 chip 时触发；一般语义 = toggle 该 reaction。 */
  onClick?: () => void
  /** 无操作权限或消息状态不可用时禁用点击。 */
  disabled?: boolean
  /** 悬浮 tooltip；一般传完整用户列表，避免文本被截断后无法看到全部。 */
  title?: string
  /** 供 parent 追加分类数据（例如上报埋点、click-to-picker 定位），组件不消费。 */
  reactionType?: MessageReactionType
  reactionKey?: string
}

export interface MessageReactionSummaryProps {
  chips: MessageReactionChip[]
  /**
   * 末尾"+ 加号"按钮回调。传入时才渲染。
   * 用于快速触发 reaction picker，与右键菜单入口并列。
   * 透传 click 事件，便于上层用 clientX/Y 定位 picker popover。
   */
  onAdd?: (e: React.MouseEvent) => void
  /** 加号按钮 aria-label / tooltip。 */
  addLabel?: string
  /** 允许外层追加类名以微调间距。 */
  className?: string
}

/**
 * 消息内容下方的 reaction 聚合展示条。
 *
 * 设计原则：
 * - 纯 UI，chips 由上层聚合后传入（不解析 emoji manifest、不做 i18n）；
 * - 始终左对齐，跟随消息内容左边缘（项目消息为 Slack/飞书 式全左对齐，无气泡、
 *   无发送方右对齐）；
 * - 空 chips 且无 onAdd 时不渲染任何 DOM，避免空 padding；
 * - 全部颜色/间距走 --wk-* token，自动跟随亮暗主题；
 * - onClick / onAdd 交给上层拼装 toggle 或打开 picker。
 */
export default function MessageReactionSummary({
  chips,
  onAdd,
  addLabel,
  className,
}: MessageReactionSummaryProps) {
  if (chips.length === 0 && !onAdd) return null

  return (
    <div className={classNames("wk-msg-reaction-summary", className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={classNames(
            "wk-msg-reaction-chip",
            chip.hasMine && "wk-msg-reaction-chip--mine",
          )}
          onClick={chip.onClick}
          disabled={chip.disabled}
          aria-pressed={chip.hasMine}
          title={chip.title}
        >
          <span className="wk-msg-reaction-chip-icon" aria-hidden="true">
            {chip.icon}
          </span>
          <span className="wk-msg-reaction-chip-text">{chip.text}</span>
        </button>
      ))}
      {onAdd && (
        <button
          type="button"
          className="wk-msg-reaction-add"
          onClick={(e) => onAdd(e)}
          aria-label={addLabel}
          title={addLabel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}
    </div>
  )
}
