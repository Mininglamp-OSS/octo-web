import React, { useEffect, useState } from "react"

import MessageReactionSummary, { type MessageReactionChip } from "./index"
import { aggregateReactions } from "./aggregate"
import { reactionMockStore, MOCK_REACTION_EVENT } from "./mockStore"
import { reactionPickerOverlay } from "../MessageReactionPicker/ReactionPickerOverlay"
import { useI18n } from "../../../i18n"
import WKApp from "../../../App"
import type { MessageReactionUser } from "./types"

/**
 * ⚠️ DEMO-ONLY 接线胶水，随 feature flag 一同存在。
 *
 * 把本地 mock store 的 reactions 聚合成 chips 交给 MessageReactionSummary 渲染，
 * 并订阅 store 变更做局部刷新。生产化时：
 * - 数据源从 reactionMockStore 换成 message.reactions（Convert 解析 + CMD 刷新）
 * - onSelect / chip toggle 换成 datasource 写接口 + 乐观更新
 * 组件本体（MessageReactionSummary / Picker）无需改动。
 */

interface ReactionSlotProps {
  messageId: string
}

/** 名单分隔符：中文顿号、其它逗号（zh-CN / en-US 两个基线 locale）。 */
function nameSeparator(locale: string): string {
  return locale.startsWith("zh") ? "、" : ", "
}

function formatUserSummary(
  users: MessageReactionUser[],
  locale: string,
  t: (key: string, opts?: { values?: Record<string, unknown> }) => string,
): string {
  const names = users.map((u) => u.name)
  // 用 locale 分隔符拼接（不用 Intl.ListFormat：dmworkbase lib=es2020 无其类型，
  // 且 unit/narrow 形态会丢分隔符）。>3 人时交给 moreUsers 文案包 "等N人 / and N total"。
  const shown = names.slice(0, 3).join(nameSeparator(locale))
  if (names.length <= 3) return shown
  return t("base.reaction.moreUsers", {
    values: { names: shown, count: names.length },
  })
}

export default function ReactionSlot({ messageId }: ReactionSlotProps) {
  const { t, locale } = useI18n()
  const [, forceTick] = useState(0)

  useEffect(() => {
    const handler = (changedId: string) => {
      if (changedId === messageId) forceTick((v) => v + 1)
    }
    WKApp.mittBus.on(MOCK_REACTION_EVENT, handler)
    return () => {
      WKApp.mittBus.off(MOCK_REACTION_EVENT, handler)
    }
  }, [messageId])

  const currentUid = WKApp.loginInfo?.uid
  const groups = aggregateReactions(reactionMockStore.get(messageId), currentUid)

  const chips: MessageReactionChip[] = groups.map((g) => {
    // 图标解析：仅自定义/品牌 token（[尚方宝剑]/[使命必达]/[收到] 等）经 EmojiService
    // 解析成图片；unicode emoji（👍 等）保留字形。必须先判 isCustomEmoji —— EmojiService
    // 对 unicode 也内置了位图 URL，若无脑 getImage 会把 👍 也换成位图（与预期不符）。
    const token = g.emoji ?? g.reactionKey
    const isCustom = WKApp.emojiService?.isCustomEmoji?.(token) ?? false
    const url = isCustom ? WKApp.emojiService?.getImage?.(token) ?? "" : ""
    const icon: React.ReactNode = url ? (
      <img src={url} alt="" draggable={false} />
    ) : (
      token
    )
    return {
      key: `${g.reactionType}-${g.reactionKey}`,
      icon,
      text: formatUserSummary(g.users, locale, t),
      hasMine: g.hasMine,
      title: g.users.map((u) => u.name).join(nameSeparator(locale)),
      onClick: () =>
        reactionMockStore.toggle(messageId, g.reactionKey, g.emoji ?? g.reactionKey),
      reactionType: g.reactionType,
      reactionKey: g.reactionKey,
    }
  })

  return (
    <MessageReactionSummary
      chips={chips}
      addLabel={t("base.module.contextMenus.react")}
      onAdd={(e) =>
        reactionPickerOverlay.open({ x: e.clientX, y: e.clientY, messageId })
      }
    />
  )
}
