// Bot 任务状态判定(原型 `.agent-execution` 的 `.agent-status`)。
//
// **只判定我们真能观测到的状态。** 原型列了 7 个:received / running / applied / undone /
// cancelled / stale / permission-denied。我们手上没有任务状态通道 —— 插件端刻意不再把工具
// 进度发进评论区(那会把评论区刷满,见 openclaw 插件 inbound.ts 的 kind === "tool" 分支),
// 也没有任何一张表记录「这条评论对应的任务现在到哪一步」。所以这里能诚实给出的只有 3 个:
//
//   running  —— 根评论 @ 了 Bot,但该 Bot 还没在串里回过话
//   applied  —— 该 Bot 已经在串里回过话(它干完了,或者它如实报告了失败)
//   stale    —— 已完成,但被引用的原文之后又变了(锚点判定给的 'changed')
//
// 剩下 4 个**故意不渲染**,因为没有数据源,渲染出来就是假的:
//   received      与 running 无从区分(没有「已取到任务」的回执通道)
//   cancelled     没有取消功能,也没有取消记录
//   undone        撤销走版本接口(BotEditRevertButton),不与评论串关联,查不到是哪条评论被撤销
//   permission-denied  @ 菜单在前端就把无权限的 Bot 挡掉了,组不出这种评论;而服务端侧的
//                      拒绝不产生任何串内可见痕迹(事件被丢弃)
// 等哪天有了任务状态通道,把 BotTaskState 补齐、在这里多几个分支即可,调用方不用动。

import type { Comment, CommentThread } from './api.ts'
import type { AnchorState } from './threadMeta.ts'
import { extractMentions } from '../mentions/source.ts'

export type BotTaskState = 'running' | 'no-reply' | 'applied' | 'stale'

/**
 * 一条 Bot 回复该套什么卡片 + 串尾是否还在等回话。
 *
 * ★ 模型:卡片是**每条 Bot 回复各一张、留在原位**,不是整条串一张提到顶上。
 *
 * 之前两版都错在「提升」上:先是取最后一条 Bot 回复提到卡片里,再是加了「必须是最后一条」的
 * 条件 —— 追问串里那个条件恰好成立,于是答复照样被排到问题前面,列表停在一个看起来没人回答
 * 的问题上。根因不是判据不够精细,是**只要移动就会打乱时序**。不移动就没有这个问题:
 *
 *   根            @bot 写入你好
 *   [卡片] bot    写入了「你好」
 *   用户          @bot 再写入888
 *   [卡片] bot    写入了 888
 *
 * 「还在跑 / 未见回复」是串**尾部**的状态,所以单独一张卡片挂在最后,而不是挂在顶上 ——
 * 它说的是「最后这句请求还没被答复」,顶上那条早就答完了。
 */
export interface BotThread {
  /** 被 @ 的 Bot uid。 */
  botUid: string
  /** 串尾还在等这个 Bot 回话时的状态;null = 不在等(最后一条就是它的回复)。 */
  pending: 'running' | 'no-reply' | null
  /** 每条 Bot 回复的卡片状态。整条串共用一个 —— 锚点状态是文档级的,不分轮次。 */
  replyState: 'applied' | 'stale'
}

/**
 * 超过这么久还没见到 Bot 回复,就不再说「处理中」。
 *
 * 一次任务从入队到回复是几十秒级(事件轮询 + agent 干活),10 分钟远超正常上限。撑到这里
 * 说明发生了别的事,而**我们分不清是哪一件**:任务没人取(被 @ 的 Bot 所在渠道不消费事件
 * 队列)、agent 崩了、事件过期、或者回复被人删了(实测遇到过:7 条回复被清理掉,卡片却一直
 * 显示「处理中」)。所以文案只说「未见回复」,不替它编一个原因。
 */
export const NO_REPLY_AFTER_MS = 10 * 60 * 1000

export interface BotTask {
  state: BotTaskState
  /** 被 @ 的 Bot uid。渲染卡片头部的名字用,也是「谁该回话」的判据。 */
  botUid: string
  /**
   * 这个 Bot 在串里的**最后一条**回复,也就是它的结论。卡片正文渲染它,而不是渲染一句
   * 写死的「Bot 已按这条评论修改了文档」——那句话不管 Bot 实际成功还是道歉都照样显示,
   * 是在替 Bot 说它没说过的话。用真回复就没有这个问题。
   *
   * 取**最后一条**而不是第一条:早期的工具进度评论(抑制上线前留下的)也在这个串里,
   * 结论永远在最末尾。null 表示它还没回话(state==='running')。
   */
  reply: Comment | null
  /** 根评论的创建时间(ISO)。「根评论 → Bot 回复」这个区间用来定位 Bot 的安全快照版本。 */
  rootCreatedAt: string
}

/**
 * 这条评论串是不是一个 Bot 任务;是的话它到哪一步了。
 *
 * 返回 null 表示「不是 Bot 任务」—— 不渲染卡片。判定是 fail-closed 的:`botUids` 为空
 * (Space 的 Bot 名册还没加载出来,或者加载失败)时一律返回 null。宁可少一张卡片,也不要
 * 把人类之间的讨论套上「AI 修改」的外壳。
 */
export function deriveBotTask(
  thread: CommentThread,
  botUids: ReadonlySet<string> | undefined,
  anchorState: AnchorState,
  nowMs: number = Date.now(),
): BotTask | null {
  if (!botUids || botUids.size === 0) return null

  // 被 @ 的 Bot 才是这个任务的执行者。用根评论的 @ 而不是「串里出现过的任何 bot uid」:
  // 后者会把「Bot 顺手回了一句」也算成一个任务。
  const mentioned = extractMentions(thread.body).find(
    (item) => item.type === 'user' && botUids.has(item.id),
  )
  if (!mentioned) return null

  const last = thread.replies.length > 0 ? thread.replies[thread.replies.length - 1]! : null
  const answered = thread.replies.some((reply) => reply.authorUid === mentioned.id)

  if (!answered) {
    // 「处理中」只在**确实还有可能在跑**的时候说。超时之后改成「未见回复」——
    // 让人一直等一个不会来的结果,比说「不知道发生了什么」糟得多。
    const startedAt = Date.parse(thread.createdAt)
    const overdue = Number.isFinite(startedAt) && nowMs - startedAt > NO_REPLY_AFTER_MS
    return {
      state: overdue ? 'no-reply' : 'running',
      botUid: mentioned.id,
      reply: null,
      rootCreatedAt: thread.createdAt,
    }
  }

  // reply 只在「串里除了这个 Bot 没有别人说过话」时才交给卡片去渲染。
  //
  // 卡片渲染在所有回复**之上**,把一条回复提进卡片 == 把它排到全部回复前面。
  //
  // 判据是「有没有别人说过话」,不是「Bot 的回复是不是最后一条」——后者我试过,是错的:
  // 追问序列(问 → 答 → 再问 → 再答)里 Bot 的答复**正好就是**最后一条,于是照样被提到顶上,
  // 答复排在问题前面,而列表停在一个看起来没人回答的问题上。实测截图如此。
  //
  // 有人类插话就意味着形成了问答时序,任何提升都会打乱它。反过来,全是这个 Bot 的回复时
  // (抑制上线前遗留的工具进度串)彼此之间没有对话语义,把最后那条(结论)提上来是安全的。
  const otherSpoke = thread.replies.some((reply) => reply.authorUid !== mentioned.id)
  const reply = !otherSpoke && last != null && last.authorUid === mentioned.id ? last : null
  // 'changed' = 引用的原文在 Bot 改完之后又变了。'updated' 不算 stale —— 那正是 Bot
  // 自己改的,把它报成「正文已变化」等于让 Bot 自己干的事看起来像出了问题。
  return {
    state: anchorState === 'changed' ? 'stale' : 'applied',
    botUid: mentioned.id,
    reply,
    rootCreatedAt: thread.createdAt,
  }
}

/** 这条回复是不是那个执行者 Bot 发的(该套卡片)。 */
export function isBotReply(comment: Comment, botUid: string): boolean {
  return comment.authorUid === botUid
}

/**
 * 按新模型解析一条评论串:执行者是谁、每条 Bot 回复套什么状态、串尾是否还在等。
 *
 * 返回 null = 不是 Bot 任务(根评论没 @ 到任何已知 Bot),调用方照旧渲染普通评论串。
 * fail-closed:botUids 为空(名册没加载出来/加载失败)时一律 null —— 宁可少一张卡片,
 * 也不要把人类之间的讨论套上「AI 修改」的外壳。
 */
export function deriveBotThread(
  thread: CommentThread,
  botUids: ReadonlySet<string> | undefined,
  anchorState: AnchorState,
  nowMs: number = Date.now(),
): BotThread | null {
  if (!botUids || botUids.size === 0) return null
  const mentioned = extractMentions(thread.body).find(
    (item) => item.type === 'user' && botUids.has(item.id),
  )
  if (!mentioned) return null
  const botUid = mentioned.id

  // 串尾:最后一条是这个 Bot 的回复 ⇒ 不在等。否则在等,计时从**最后那句话**算起
  // (不是根评论)—— 追问串里根评论可能是几小时前的,拿它算超时会一进门就报「未见回复」。
  const last = thread.replies.length > 0 ? thread.replies[thread.replies.length - 1]! : null
  const waitingSince = last ? last.createdAt : thread.createdAt
  let pending: BotThread['pending'] = null
  if (!last || !isBotReply(last, botUid)) {
    const since = Date.parse(waitingSince)
    const overdue = Number.isFinite(since) && nowMs - since > NO_REPLY_AFTER_MS
    pending = overdue ? 'no-reply' : 'running'
  }

  // 'changed' = 引用的原文在 Bot 改完之后又变了。'updated' 不算 stale —— 那正是 Bot
  // 自己改的,把它报成「正文已变化」等于让 Bot 自己干的事看起来像出了问题。
  return { botUid, pending, replyState: anchorState === 'changed' ? 'stale' : 'applied' }
}

/** 状态 chip 的色调,对应原型的 `.agent-status.is-*`。 */
export function botTaskTone(state: BotTaskState): 'running' | 'success' | 'review' {
  if (state === 'applied') return 'success'
  // 「未见回复」和「正文已变化」都是「需要你看一眼」,共用 review 色调。不给它单独一色 ——
  // 增删已经占了红绿,再来第三第四种颜色,读者得先学一遍色表(表格 diff 那个黄色就是前车之鉴)。
  if (state === 'stale' || state === 'no-reply') return 'review'
  return 'running'
}
