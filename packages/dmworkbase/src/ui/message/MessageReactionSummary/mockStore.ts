import WKApp from "../../../App"
import type { MessageReaction } from "./types"

/**
 * ⚠️ DEMO-ONLY 本地 mock 数据层，随 feature flag 一同存在。
 *
 * 服务端 reaction 契约就绪后整体删除：真实 reactions 由 Convert.toMessage 从
 * 消息同步响应解析、写入走 datasource、实时刷新走 CMD（见
 * .context/message-reaction-api-spec.md）。此文件仅用于在 flag 打开时让
 * 完整交互（首屏展示 + toggle + 乐观更新）在无服务端下也能点通、可截图。
 *
 * 存储：内存 Map<messageId, MessageReaction[]>，不持久化、刷新即重置。
 * 变更通过 WKApp.mittBus 广播，消息 cell 订阅后 forceUpdate 刷新。
 */

export const MOCK_REACTION_EVENT = "message-reaction-mock-updated"

const MOCK_NAMES = ["张三", "李四", "王五", "赵六", "田七", "孙八"]

/** 种子用的常用 emoji（unicode），确定性分配给部分消息 */
const SEED_EMOJIS = ["👍", "❤️", "🎉", "😂", "🔥"]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function currentUid(): string {
  return WKApp.loginInfo?.uid || "__me__"
}

function currentName(): string {
  // loginInfo.name 缺省时兜底；demo 展示用，不影响协议
  return (WKApp.loginInfo as { name?: string })?.name || "我"
}

class ReactionMockStore {
  private map = new Map<string, MessageReaction[]>()
  private seeded = new Set<string>()

  /**
   * 读取某消息的 reactions。首次访问按 messageId hash 确定性生成种子数据，
   * 让首屏就有部分消息带 reaction（真实感），且同一 messageId 每次结果一致。
   */
  get(messageId: string): MessageReaction[] {
    if (!this.seeded.has(messageId)) {
      this.seeded.add(messageId)
      const seeded = this.seed(messageId)
      if (seeded.length > 0) this.map.set(messageId, seeded)
    }
    return this.map.get(messageId) ?? []
  }

  private seed(messageId: string): MessageReaction[] {
    const h = hashString(messageId)
    // 约 1/3 的消息带 reaction，其余为空，避免每条都挂显得假
    if (h % 3 !== 0) return []

    const emojiCount = 1 + (h % 2) // 1~2 个 reaction 组
    const out: MessageReaction[] = []
    let seq = 1
    for (let g = 0; g < emojiCount; g++) {
      const emoji = SEED_EMOJIS[(h + g) % SEED_EMOJIS.length]
      const userCount = 1 + ((h >> (g + 1)) % 4) // 1~4 人
      for (let u = 0; u < userCount; u++) {
        out.push({
          seq: seq++,
          uid: `mock-u${g}-${u}`,
          name: MOCK_NAMES[(h + g + u) % MOCK_NAMES.length],
          reactionType: "emoji",
          reactionKey: emoji,
          emoji,
        })
      }
    }
    return out
  }

  /**
   * toggle 当前用户对某 (messageId, reactionKey) 的 reaction。
   * 已存在 → 移除自己（组空则整组消失）；不存在 → 追加自己。
   * emojiChar 用于新建组时的可渲染字符（token 表情走 image 时另议）。
   */
  toggle(messageId: string, reactionKey: string, emojiChar: string): void {
    const uid = currentUid()
    const list = [...this.get(messageId)]
    const mineIdx = list.findIndex(
      (r) => r.reactionKey === reactionKey && r.uid === uid,
    )
    if (mineIdx >= 0) {
      list.splice(mineIdx, 1)
    } else {
      const maxSeq = list.reduce((m, r) => Math.max(m, r.seq ?? 0), 0)
      list.push({
        seq: maxSeq + 1,
        uid,
        name: currentName(),
        reactionType: "emoji",
        reactionKey,
        emoji: emojiChar,
      })
    }
    this.map.set(messageId, list)
    WKApp.mittBus.emit(MOCK_REACTION_EVENT, messageId)
  }
}

export const reactionMockStore = new ReactionMockStore()
