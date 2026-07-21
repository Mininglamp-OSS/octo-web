import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"

import MessageReactionSummary, {
  type MessageReactionChip,
} from "./index"
import { aggregateReactions } from "./aggregate"
import type { MessageReaction } from "./types"

const meta: Meta<typeof MessageReactionSummary> = {
  title: "ui/message/MessageReactionSummary",
  component: MessageReactionSummary,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "消息内容下方的 reaction 聚合条（始终左对齐）。纯 UI，chips 由上层聚合并格式化好文本后传入。",
      },
    },
  },
}
export default meta
type Story = StoryObj<typeof MessageReactionSummary>

const CURRENT_UID = "me"

/**
 * 用「已聚合好的 groups」→「chips」的最简样例映射，便于 story 展示。
 * 实际生产使用时，parent 需接入 i18n 与 emoji manifest 后组装 chips。
 */
function groupsToDemoChips(
  reactions: MessageReaction[],
  opts?: { onToggle?: (key: string) => void },
): MessageReactionChip[] {
  const groups = aggregateReactions(reactions, CURRENT_UID)
  return groups.map((g) => {
    const names = g.users.map((u) => u.name)
    const shown = names.slice(0, 3)
    const remain = names.length - shown.length
    const text =
      remain > 0
        ? `${shown.join("、")}等 ${names.length} 人`
        : shown.join("、")
    const icon =
      g.reactionType === "emoji" ? (
        g.emoji ?? g.reactionKey
      ) : g.sticker?.path ? (
        <img src={g.sticker.path} alt="" />
      ) : (
        <span aria-hidden>❓</span>
      )
    return {
      key: `${g.reactionType}-${g.reactionKey}`,
      icon,
      text,
      hasMine: g.hasMine,
      title: names.join("、"),
      onClick: () => opts?.onToggle?.(g.reactionKey),
      reactionType: g.reactionType,
      reactionKey: g.reactionKey,
    }
  })
}

const commonReactions: MessageReaction[] = [
  {
    uid: "u1",
    name: "张三",
    reactionType: "emoji",
    reactionKey: "👍",
    emoji: "👍",
    seq: 1,
  },
  {
    uid: "u2",
    name: "李四",
    reactionType: "emoji",
    reactionKey: "👍",
    emoji: "👍",
    seq: 2,
  },
  {
    uid: CURRENT_UID,
    name: "我自己",
    reactionType: "emoji",
    reactionKey: "❤️",
    emoji: "❤️",
    seq: 3,
  },
]

/** 单个 chip。 */
export const Single: Story = {
  args: {
    chips: groupsToDemoChips([commonReactions[0]]),
  },
}

/** 多个 chip，其中一个 hasMine 高亮。 */
export const MultipleWithMine: Story = {
  args: {
    chips: groupsToDemoChips(commonReactions),
  },
}

/** 超过 3 人 → "…等 N 人"。 */
export const OverflowUsers: Story = {
  args: {
    chips: groupsToDemoChips([
      ...Array.from({ length: 6 }).map((_, i) => ({
        uid: `u${i}`,
        name: `用户${i + 1}`,
        reactionType: "emoji" as const,
        reactionKey: "🎉",
        emoji: "🎉",
        seq: i,
      })),
    ]),
  },
}

/** 长用户名 + 多语言：文本超长时 chip 内部省略号截断，tooltip 显示完整。 */
export const LongUserNames: Story = {
  args: {
    chips: groupsToDemoChips([
      {
        uid: "u1",
        name: "非常非常长的中文用户名字符长度到二十字",
        reactionType: "emoji",
        reactionKey: "🚀",
        emoji: "🚀",
        seq: 1,
      },
      {
        uid: "u2",
        name: "AnExtremelyLongEnglishDisplayNameThatWillTruncate",
        reactionType: "emoji",
        reactionKey: "🚀",
        emoji: "🚀",
        seq: 2,
      },
    ]),
  },
}

/** 大量 reaction 换行。 */
export const ManyReactions: Story = {
  args: {
    chips: groupsToDemoChips(
      "👍❤️🎉😂😢🔥💯🚀✨🎯"
        .split("")
        .map((emoji, i) => ({
          uid: `u${i}`,
          name: `U${i}`,
          reactionType: "emoji" as const,
          reactionKey: emoji,
          emoji,
          seq: i,
        })),
    ),
  },
}

/**
 * `[收到]` token —— parent 需要走 emoji manifest 解析成 <img>；
 * 若解析失败，降级展示原始 token 文本，保证信息不丢。
 */
export const UnknownEmojiToken: Story = {
  render: () => {
    const chips: MessageReactionChip[] = [
      {
        key: "emoji-[收到]",
        icon: <span style={{ fontSize: 12 }}>[收到]</span>,
        text: "张三、李四",
        hasMine: false,
        title: "张三、李四",
      },
    ]
    return <MessageReactionSummary chips={chips} />
  },
}

/** sticker 资源失效时的降级：parent 传入占位 icon。 */
export const StickerBrokenFallback: Story = {
  render: () => {
    const chips: MessageReactionChip[] = [
      {
        key: "sticker-broken",
        icon: (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 16,
              height: 16,
              borderRadius: 3,
              background: "var(--wk-bg-hover)",
              border: "1px dashed var(--wk-text-tertiary)",
            }}
          />
        ),
        text: "王五",
        hasMine: false,
        title: "王五",
      },
    ]
    return <MessageReactionSummary chips={chips} />
  },
}

/** 带"+"入口，用于触发 reaction picker。 */
export const WithAddButton: Story = {
  args: {
    chips: groupsToDemoChips(commonReactions),
    onAdd: () => {
      /* Story only: open picker */
    },
    addLabel: "贴表情",
  },
}

/** 禁用态：无权限或消息不可操作。 */
export const DisabledChips: Story = {
  render: () => {
    const chips = groupsToDemoChips(commonReactions).map((c) => ({
      ...c,
      disabled: true,
    }))
    return <MessageReactionSummary chips={chips} />
  },
}

/** 空 chips + 无 onAdd → 不渲染 DOM（用于验证条件渲染）。 */
export const EmptyRendersNothing: Story = {
  args: {
    chips: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          "chips 为空且未传 onAdd 时组件返回 null，避免消息下方出现无内容 padding。",
      },
    },
  },
}
