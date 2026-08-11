// 把 HTML 文档的评论串适配成 comments/botTask.ts 认识的形状,以便复用「AI 修改卡片」的
// 那套判定(deriveBotThread / isBotReply)。
//
// ── 为什么是适配而不是各写一套 ──────────────────────────────────────────────────
// 判定「这条串是不是 Bot 任务、Bot 答复了没、答完之后原文有没有变」的规则很细,而且踩过坑:
// 卡片提到顶部会打乱时序(改过两版)、Bot 自己造成的正文变化不能报成「引用已失效」、
// 「处理中」不能永远转圈。这些结论都沉在 botTask.ts 的注释和用例里。HTML 侧再写一份,
// 等于把那些坑重踩一遍 —— 只是字段名不同,规则完全一样。
//
// 两侧的形状差异(html/htmlDocComments.ts 的 OctoDocComment vs comments/api.ts 的 Comment):
//   id          string          ↔ number
//   text        string          ↔ body
//   author.login                ↔ authorUid
//   created_at  string|null     ↔ createdAt string
// 这个模块只做这层翻译,不含任何判定逻辑。
import { extractMentions } from '../mentions/source.ts'
import type { Comment, CommentThread } from '../comments/api.ts'
import type { OctoDocComment, OctoDocCommentThread } from './htmlDocComments.ts'

/**
 * 这条回复是不是「被 @ 的那个 Bot」发的。
 *
 * 判据是 author.kind === 'agent',不是比 uid —— 见 adaptHtmlThread 里的说明。
 * 组件渲染每条回复时要用它决定「套不套 AI 卡片」,必须和 adaptHtmlThread 的映射同一个
 * 判据,否则会出现「串被判成 Bot 任务、但没有一条回复被认成 Bot 的」这种自相矛盾。
 */
export function isHtmlAgentReply(c: OctoDocComment): boolean {
  return c.author?.kind === 'agent'
}

/**
 * HTML 评论的 id 是不透明字符串(如 `c_20260810041331749_deba024d`),而 Comment.id 是
 * number。**不做解析**:把它转成数字要么丢失信息要么凭空发明一个。
 *
 * 这里给 0 是安全的,因为下游只把 id 当作 React key 之外的标识用不到 —— deriveBotThread /
 * isBotReply 只读 authorUid / body / createdAt / replies。真实 id 由调用方自己保留。
 */
const ADAPTED_ID = 0

export function adaptHtmlComment(c: OctoDocComment): Comment {
  return {
    id: ADAPTED_ID,
    docId: '',
    parentId: null,
    // 判定 Bot 回复靠这个字段 —— HTML 侧作者是 author.login。取不到就给空串,
    // 那样 isBotReply 一律不命中(fail closed),不会把人的回复错认成 Bot 的。
    authorUid: c.author?.login ?? '',
    body: c.text ?? '',
    anchorStart: null,
    anchorEnd: null,
    // anchorText 是 string(非 nullable)。这里恒给空串:HTML 的锚点是 aid + 引用文字,
    // 不是 Yjs 的相对位置,而判定侧只用它算「引用有没有变」—— HTML 侧那件事由
    // octo-doc 的锚点迁移负责(发布时迁 aid),前端不重算,所以传空即「不参与判定」。
    anchorText: '',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    // 时间用于「等了多久还没回」的判定。缺失时给空串:Date.parse('') 是 NaN,
    // botTask.ts 对 NaN 的处理是「不判超时」,也就是不会误报「未见回复」。
    createdAt: c.created_at ?? '',
    updatedAt: c.created_at ?? '',
  }
}

/** 把 HTML 评论串翻译成 CommentThread。只翻译字段,不改变任何语义。 */
export function adaptHtmlThread(thread: OctoDocCommentThread): CommentThread {
  // ★ agent 回复的作者是**固定的** `odoc-agent`(kind='agent'),不是 Bot 自己的 uid ——
  // octo-doc 的 agent 回帖口用的是一个统一身份。拿 Bot uid 去比 author.login 永远不中,
  // 卡片就永远套不上(实测:真实数据里每条 Bot 答复的 login 都是 'odoc-agent')。
  //
  // 所以把它归到「根评论 @ 的那个 uid」名下。这不是硬凑:HTML 的 agent 答复本来就是
  // 被 @ 的那个 Bot 通过 agent 接口发出来的,归给它才是事实。
  // 根评论 @ 的是人时,下游会因为那个 uid 不在 Bot 名册里而判成非 Bot 串 —— 依然安全。
  const mentionedUid = extractMentions(thread.text ?? '').find((m) => m.type === 'user')?.id ?? ''
  const asBot = (c: OctoDocComment): Comment => {
    const adapted = adaptHtmlComment(c)
    return c.author?.kind === 'agent' && mentionedUid !== ''
      ? { ...adapted, authorUid: mentionedUid }
      : adapted
  }
  return {
    ...adaptHtmlComment(thread),
    replies: (thread.replies ?? []).map(asBot),
  }
}
