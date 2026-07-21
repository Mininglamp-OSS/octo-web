import classNames from "classnames"
import React from "react"

import "./index.css"
import type { PickerEmoji } from "./data"

export type { PickerEmoji } from "./data"

export interface MessageReactionPickerProps {
  /**
   * 首屏优先展示的自定义 token 表情（`[使命必达]` 等项目专属），置顶。
   * 传空则完全省略这一段。
   */
  tokens?: PickerEmoji[]
  /**
   * 常用 unicode / manifest emoji，接在 tokens 之后同一网格里排布。
   */
  frequentlyUsed: PickerEmoji[]
  /**
   * 「更多」按钮回调；不传则不渲染。
   * 生产：点击后打开完整 EmojiToolbar / 全量 picker（Phase 2 决定挂什么）
   */
  onMore?: () => void
  /**
   * 用户选择：语义 = 提交 reaction。
   * parent 负责乐观更新 + 关闭 popover。
   */
  onSelect: (emoji: PickerEmoji) => void
  /** 当前用户已选中的 key 列表，用于高亮 */
  selectedKeys?: string[]
  /** 每行 cell 数，默认 6；保持 tokens+frequent+more 总数 = columnsPerRow × N 时视觉最齐 */
  columnsPerRow?: number
  /** 「更多」按钮的无障碍标签 / tooltip（i18n 文案由 parent 注入）。 */
  moreLabel?: string
  className?: string
}

/**
 * MessageReactionPicker — 极简 quick-pick popover
 *
 * 设计参照：企微「贴表情」二级子菜单（12 格 + 更多按钮）+ Discord 右键 quick-react。
 *
 * 布局：单一 grid（columnsPerRow 列）平铺 tokens → frequentlyUsed → more，
 * 数据不足时不留空 slot（数据打平避免顶行右侧空白）；parent 应按
 * `columnsPerRow × 行数 - 1(more)` 提供数据总量以做到严格对齐。
 *
 * 纯 UI：无 API 依赖、无 i18n（tokens/frequentlyUsed 数据由 parent 传入）
 */
export default function MessageReactionPicker({
  tokens,
  frequentlyUsed,
  onMore,
  onSelect,
  selectedKeys,
  columnsPerRow = 6,
  moreLabel,
  className,
}: MessageReactionPickerProps) {
  const selectedSet = new Set(selectedKeys ?? [])

  return (
    <div
      className={classNames("wk-msg-reaction-picker", className)}
      style={{ ["--wk-reaction-picker-cols" as string]: columnsPerRow }}
      role="dialog"
    >
      <div className="wk-msg-reaction-picker-grid">
        {tokens?.map((e) => (
          <PickerCell
            key={`tok-${e.key}`}
            emoji={e}
            selected={selectedSet.has(e.key)}
            isToken
            onSelect={onSelect}
          />
        ))}
        {frequentlyUsed.map((e) => (
          <PickerCell
            key={`freq-${e.key}`}
            emoji={e}
            selected={selectedSet.has(e.key)}
            onSelect={onSelect}
          />
        ))}
        {onMore && (
          <button
            type="button"
            className="wk-msg-reaction-picker-more"
            aria-label={moreLabel}
            title={moreLabel}
            onClick={onMore}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="16"
              height="16"
              aria-hidden
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

interface PickerCellProps {
  emoji: PickerEmoji
  selected: boolean
  isToken?: boolean
  onSelect: (emoji: PickerEmoji) => void
}

function PickerCell({ emoji, selected, isToken, onSelect }: PickerCellProps) {
  return (
    <button
      type="button"
      className={classNames(
        "wk-msg-reaction-picker-cell",
        isToken && "wk-msg-reaction-picker-cell--token",
        emoji.image && "wk-msg-reaction-picker-cell--image",
        selected && "wk-msg-reaction-picker-cell--selected",
      )}
      title={emoji.name ?? emoji.key}
      aria-label={emoji.name ?? emoji.key}
      aria-pressed={selected}
      onClick={() => onSelect(emoji)}
    >
      {emoji.image ? (
        <img src={emoji.image} alt="" draggable={false} />
      ) : (
        <span aria-hidden>{emoji.char}</span>
      )}
    </button>
  )
}
