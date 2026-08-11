// 评论串 → Bot 安全快照 的对应判定。
//
// 这里钉的核心是 **fail-closed**:不唯一就返回 null。把别人的改动展示成这条评论的结果,
// 会让人据此做出错误判断(看到一处不该有的改动,以为是自己刚让 Bot 干的),比不显示 Diff 糟得多。

import { describe, it, expect } from 'vitest'
import { pickBotEditVersion, type BotDiffHint } from './botEditForThread.ts'
import type { VersionMeta } from './api.ts'

const BOT = 'bot_1'

function version(over: Partial<VersionMeta> = {}): VersionMeta {
  return {
    docVersionSeq: 1,
    kind: 'restore-marker',
    label: 'Auto-safety before sheet edit',
    createdBy: BOT,
    createdAt: '2026-08-07T10:00:30.000Z',
    sizeBytes: 100,
    schemaVersion: 1,
    restoredFrom: null,
    ...over,
  }
}

const hint: BotDiffHint = {
  botUid: BOT,
  fromISO: '2026-08-07T10:00:00.000Z',
  toISO: '2026-08-07T10:01:00.000Z',
}

describe('pickBotEditVersion', () => {
  it('picks the single snapshot inside the window', () => {
    const v = version({ docVersionSeq: 7 })
    expect(pickBotEditVersion([v], hint)?.docVersionSeq).toBe(7)
  })

  it('returns null when nothing matches', () => {
    expect(pickBotEditVersion([], hint)).toBeNull()
  })

  it('returns null when TWO snapshots match — never guesses', () => {
    // 同一条串里被追问多次会这样。哪一次对应用户此刻问的那句,光靠时间戳分不出来,
    // 所以退回版本记录,而不是取最后一个。
    const a = version({ docVersionSeq: 7, createdAt: '2026-08-07T10:00:10.000Z' })
    const b = version({ docVersionSeq: 9, createdAt: '2026-08-07T10:00:50.000Z' })
    expect(pickBotEditVersion([a, b], hint)).toBeNull()
  })

  it('ignores a snapshot created by a DIFFERENT bot', () => {
    // 同一篇文档里可能有多个 Bot 在干活;对错了会把别人的改动算到这条评论头上。
    const other = version({ docVersionSeq: 7, createdBy: 'bot_2' })
    expect(pickBotEditVersion([other], hint)).toBeNull()
  })

  it('ignores snapshots outside the window', () => {
    const before = version({ docVersionSeq: 5, createdAt: '2026-08-07T09:59:59.000Z' })
    const after = version({ docVersionSeq: 8, createdAt: '2026-08-07T10:01:01.000Z' })
    expect(pickBotEditVersion([before, after], hint)).toBeNull()
  })

  it('includes the window boundaries', () => {
    // 快照与评论同一秒落库是常见的(任务很快),端点排除会让这种情况白白退化。
    expect(pickBotEditVersion([version({ createdAt: hint.fromISO })], hint)).not.toBeNull()
    expect(pickBotEditVersion([version({ createdAt: hint.toISO })], hint)).not.toBeNull()
  })

  it('ignores versions that are not bot safety snapshots', () => {
    // 人类点「恢复」写的是 'Auto-safety before restore' —— 白名单是精确匹配不是前缀匹配,
    // 否则会把用户自己的恢复当成 Bot 的改动。
    const humanRestore = version({ docVersionSeq: 7, label: 'Auto-safety before restore' })
    const named = version({ docVersionSeq: 8, kind: 'named', label: 'Draft v1' })
    expect(pickBotEditVersion([humanRestore, named], hint)).toBeNull()
  })

  it('returns null on an absent or unparseable hint', () => {
    expect(pickBotEditVersion([version()], null)).toBeNull()
    expect(pickBotEditVersion([version()], { ...hint, fromISO: 'not-a-date' })).toBeNull()
    // 区间反了(回复早于根评论)是数据异常,不是「匹配一切」。
    expect(pickBotEditVersion([version()], { ...hint, fromISO: hint.toISO, toISO: hint.fromISO })).toBeNull()
  })
})
