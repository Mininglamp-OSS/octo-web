import type { Meta, StoryObj } from "@storybook/react-vite"
import React, { useState } from "react"

import MessageRow from "../MessageRow"
import MessageReactionSummary, { type MessageReactionChip } from "./index"
import MessageReactionPicker from "../MessageReactionPicker"
import {
  DEFAULT_FREQUENT,
  DEFAULT_TOKENS,
  type PickerEmoji,
} from "../MessageReactionPicker/data"
import { aggregateReactions } from "./aggregate"
import type { MessageReaction } from "./types"

/**
 * 交互 demo：真实 MessageRow + MessageReactionSummary + MessageReactionPicker 组合。
 *
 * 这是把三个真实组件接进真实消息行布局的可点击验证（等价于 ReactionSlot 在应用里做的事，
 * 但用 story 内 local state 替代 WKApp/mock store，便于独立渲染与截图）。
 * 可 hover 消息行、点 chip toggle、点 + 打开 picker 选表情、chip 实时更新。
 */

const meta: Meta = {
  title: "ui/message/MessageReaction (interactive)",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "真实消息行内的 reaction 交互 demo：chip 展示 / toggle / picker 选表情 / 乐观更新。",
      },
    },
  },
}
export default meta
type Story = StoryObj

const ME = "me"

/** story 内把 MessageReaction[] 聚合成 chips（等价 ReactionSlot 的组装逻辑） */
function toChips(
  reactions: MessageReaction[],
  onToggle: (key: string, char: string) => void,
): MessageReactionChip[] {
  return aggregateReactions(reactions, ME).map((g) => {
    const names = g.users.map((u) => u.name)
    const shown = names.slice(0, 3).join("、")
    const text = names.length > 3 ? `${shown}等 ${names.length} 人` : shown
    return {
      key: `${g.reactionType}-${g.reactionKey}`,
      icon: g.emoji ?? g.reactionKey,
      text,
      hasMine: g.hasMine,
      title: names.join("、"),
      onClick: () => onToggle(g.reactionKey, g.emoji ?? g.reactionKey),
      reactionType: g.reactionType,
      reactionKey: g.reactionKey,
    }
  })
}

interface DemoRowProps {
  sender: string
  avatarText: string
  avatarClass: string
  isBot?: boolean
  body: string
  seed: MessageReaction[]
}

function DemoRow({ sender, avatarText, avatarClass, isBot, body, seed }: DemoRowProps) {
  const [reactions, setReactions] = useState<MessageReaction[]>(seed)
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)

  const toggle = (key: string, char: string) => {
    setReactions((prev) => {
      const mine = prev.findIndex((r) => r.reactionKey === key && r.uid === ME)
      if (mine >= 0) return prev.filter((_, i) => i !== mine)
      const maxSeq = prev.reduce((m, r) => Math.max(m, r.seq ?? 0), 0)
      return [
        ...prev,
        { seq: maxSeq + 1, uid: ME, name: "我自己", reactionType: "emoji", reactionKey: key, emoji: char },
      ]
    })
  }

  const mineKeys = aggregateReactions(reactions, ME)
    .filter((g) => g.hasMine)
    .map((g) => g.reactionKey)

  return (
    <div style={{ position: "relative" }}>
      <MessageRow
        isSend={false}
        isContinue={false}
        isSelected={false}
        showAvatar
        avatarUrl=""
        senderName={sender}
        isBot={isBot}
        timestamp="14:57"
      >
        <div>
          <div style={{ fontSize: 14, lineHeight: "22px", color: "var(--wk-text-primary)" }}>
            {/* 头像用纯色块替身（story 无真实头像资源） */}
            {body}
          </div>
          <MessageReactionSummary
            chips={toChips(reactions, toggle)}
            addLabel="贴表情"
            onAdd={(e) => setPicker({ x: e.clientX, y: e.clientY })}
          />
        </div>
      </MessageRow>

      {picker && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={() => setPicker(null)}
          />
          <div style={{ position: "fixed", left: picker.x, top: Math.max(8, picker.y - 108), zIndex: 9999 }}>
            <MessageReactionPicker
              tokens={DEFAULT_TOKENS}
              frequentlyUsed={DEFAULT_FREQUENT}
              selectedKeys={mineKeys}
              moreLabel="更多"
              onSelect={(e: PickerEmoji) => {
                toggle(e.char, e.char)
                setPicker(null)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

const seededBot: MessageReaction[] = [
  { seq: 1, uid: "u1", name: "张三", reactionType: "emoji", reactionKey: "👍", emoji: "👍" },
  { seq: 2, uid: "u2", name: "李四", reactionType: "emoji", reactionKey: "👍", emoji: "👍" },
  { seq: 3, uid: ME, name: "我自己", reactionType: "emoji", reactionKey: "❤️", emoji: "❤️" },
]

/** 完整可点交互：hover 行、点 chip toggle、点 + 开 picker。 */
export const Interactive: Story = {
  render: () => (
    <div style={{ padding: "24px 0", maxWidth: 760 }}>
      <DemoRow
        sender="郭斌_1"
        avatarText="郭"
        avatarClass="a"
        body="看一下这个功能，帮我贴个表情反馈下"
        seed={[]}
      />
      <DemoRow
        sender="BotFather"
        avatarText="B"
        avatarClass="b"
        isBot
        body="好的，我这就更新一下文档，同步给大家"
        seed={seededBot}
      />
    </div>
  ),
}
