// Bot 任务状态判定(botTask.ts)。
//
// 这里钉的是**判定的克制**:哪些情况该出卡片、哪些绝不该。误判的代价不对称 ——
// 少一张卡片只是少个提示,多一张就是把人类之间的讨论套上「AI 修改」的外壳,或者把
// Bot 自己干的事报成「正文已变化」让用户以为出了问题。

import { describe, it, expect } from 'vitest'
import { deriveBotThread, isBotReply, botTaskTone, NO_REPLY_AFTER_MS } from './botTask.ts'
import type { CommentThread, Comment } from './api.ts'

const BOT = 'bot_1'
const HUMAN = 'u_1'
const BOTS = new Set([BOT])

/**
 * 「现在」= 夹具根评论创建后 1 秒。断言 state 为 'running' 的用例必须显式传它:
 * 夹具的 createdAt 是固定日期,跑测试时真实 now 早就超过 NO_REPLY_AFTER_MS,
 * 不传就会被判成 'no-reply'(那是对的行为,只是这些用例问的不是超时)。
 */
const JUST_NOW = Date.parse('2026-08-06T10:00:01Z')

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    docId: 'd_1',
    parentId: null,
    authorUid: HUMAN,
    body: '',
    anchorStart: null,
    anchorEnd: null,
    anchorText: '被引用的原文',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-08-06T10:00:00Z',
    updatedAt: '2026-08-06T10:00:00Z',
    ...over,
  }
}

function thread(body: string, replies: Comment[] = [], over: Partial<Comment> = {}): CommentThread {
  return { ...comment({ body, ...over }), replies }
}

describe('deriveBotThread — 是不是 Bot 任务', () => {
  it('is not a bot task when the root mentions nobody', () => {
    expect(deriveBotThread(thread('随手记一句'), BOTS, 'active')).toBeNull()
  })

  it('is not a bot task when the root only mentions a human', () => {
    expect(deriveBotThread(thread(`@[user:${HUMAN}:老王] 看一下`), BOTS, 'active')).toBeNull()
  })

  it('fails closed when the bot roster has not loaded', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`)
    expect(deriveBotThread(th, undefined, 'active')).toBeNull()
    expect(deriveBotThread(th, new Set(), 'active')).toBeNull()
  })

  it('reports the mentioned bot as the executor', () => {
    // 执行者由**根评论的 @** 决定,不是「串里出现过的任何 bot uid」——
    // 后者会把「别的 Bot 顺手回了一句」也算成这条任务的执行者。
    const th = thread(`@[user:${BOT}:test11] 改一下`, [comment({ id: 2, authorUid: 'bot_2', body: '路过' })])
    expect(deriveBotThread(th, new Set([BOT, 'bot_2']), 'active', JUST_NOW)?.botUid).toBe(BOT)
  })
})

describe('deriveBotThread — 串尾是否还在等回话', () => {
  it('is pending right after the root request', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`)
    expect(deriveBotThread(th, BOTS, 'active', JUST_NOW)?.pending).toBe('running')
  })

  it('is NOT pending when the bot spoke last', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`, [comment({ id: 2, authorUid: BOT, body: '好了' })])
    expect(deriveBotThread(th, BOTS, 'active')?.pending).toBeNull()
  })

  it('is pending again after a human follow-up', () => {
    // 追问序列:答完之后又被问了一句 ⇒ 重新进入等待。这正是「卡片挂在串尾」的理由 ——
    // 顶上那轮早就答完了。
    const th = thread(`@[user:${BOT}:test11] 写入你好`, [
      comment({ id: 2, authorUid: BOT, body: '已写入你好', createdAt: '2026-08-06T10:00:05Z' }),
      comment({ id: 3, authorUid: HUMAN, body: `@[user:${BOT}:test11] 再写入888`, createdAt: '2026-08-06T10:00:10Z' }),
    ])
    expect(deriveBotThread(th, BOTS, 'active', Date.parse('2026-08-06T10:00:11Z'))?.pending).toBe('running')
  })

  it('times the wait from the LAST message, not the root', () => {
    // 追问串的根评论可能是几小时前的。拿它算超时,一进门就会误报「未见回复」。
    const th = thread(`@[user:${BOT}:test11] 写入你好`, [
      comment({ id: 2, authorUid: BOT, body: '好了', createdAt: '2026-08-06T10:00:05Z' }),
      comment({ id: 3, authorUid: HUMAN, body: '再来', createdAt: '2026-08-06T18:00:00Z' }),
    ])
    // 距根评论 8 小时(远超阈值),但距最后那句只有 1 秒 ⇒ 仍是 running。
    expect(deriveBotThread(th, BOTS, 'active', Date.parse('2026-08-06T18:00:01Z'))?.pending).toBe('running')
  })

  it('flips to no-reply past the window', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`)
    const t0 = Date.parse(th.createdAt)
    expect(deriveBotThread(th, BOTS, 'active', t0 + NO_REPLY_AFTER_MS + 1)?.pending).toBe('no-reply')
  })

  it('stays running when the timestamp is unparseable', () => {
    // 解不出时间就不判超时(NaN 比较恒为假,但要显式保证不会误报)。
    const th = thread(`@[user:${BOT}:test11] 改一下`, [], { createdAt: 'nope' })
    expect(deriveBotThread(th, BOTS, 'active', JUST_NOW)?.pending).toBe('running')
  })
})

describe('deriveBotThread — 每条 Bot 回复的卡片状态', () => {
  it('is applied normally', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`, [comment({ id: 2, authorUid: BOT, body: '好了' })])
    expect(deriveBotThread(th, BOTS, 'active')?.replyState).toBe('applied')
  })

  it("does not read the bot's OWN edit as stale", () => {
    // anchorState 'updated' 正是 Bot 改动本身造成的。报成「正文已变化」等于把它干成的事
    // 说成出了问题。
    const th = thread(`@[user:${BOT}:test11] 改一下`, [comment({ id: 2, authorUid: BOT, body: '好了' })])
    expect(deriveBotThread(th, BOTS, 'updated')?.replyState).toBe('applied')
  })

  it('is stale when the quoted text changed afterwards', () => {
    const th = thread(`@[user:${BOT}:test11] 改一下`, [comment({ id: 2, authorUid: BOT, body: '好了' })])
    expect(deriveBotThread(th, BOTS, 'changed')?.replyState).toBe('stale')
  })
})

describe('isBotReply', () => {
  it('matches only that executor bot', () => {
    // 卡片按这个判据逐条套。人类追问和别的 Bot 都不套 —— 卡片是「AI 修改」的外壳,
    // 套错了就是在替别人认领改动。
    expect(isBotReply(comment({ authorUid: BOT }), BOT)).toBe(true)
    expect(isBotReply(comment({ authorUid: HUMAN }), BOT)).toBe(false)
    expect(isBotReply(comment({ authorUid: 'bot_2' }), BOT)).toBe(false)
  })
})

describe('botTaskTone', () => {
  it('maps each state to the prototype chip tone', () => {
    expect(botTaskTone('running')).toBe('running')
    expect(botTaskTone('applied')).toBe('success')
    expect(botTaskTone('stale')).toBe('review')
    // 「未见回复」与「正文已变化」共用 review —— 都是「需要你看一眼」。不自造第四种颜色
    // (表格 diff 那个黄色是前车之鉴)。
    expect(botTaskTone('no-reply')).toBe('review')
  })
})
