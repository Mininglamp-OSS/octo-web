// Bot 任务卡片(原型 `.agent-execution`)。
//
// 挂在 Bot 评论串的顶部,一眼看出「谁在改、改到哪一步、改完了去哪看改动」。结构照原型:
// header(头像 + Bot 名 + 「AI 修改」 + 状态 chip)/ body(状态文案或结果行)/ footer(操作)。
//
// 状态只有 3 个,原因见 botTask.ts 顶部 —— 剩下 4 个没有数据源,不渲染假 UI。

import type { ReactNode } from 'react'
import { t } from '../octoweb/index.ts'
import { botTaskTone, type BotTask } from './botTask.ts'
import type { BotDiffHint } from '../versions/botEditForThread.ts'

const STATE_LABEL: Record<BotTask['state'], string> = {
  running: 'docs.comment.botTask.running',
  'no-reply': 'docs.comment.botTask.noReply',
  applied: 'docs.comment.botTask.applied',
  stale: 'docs.comment.botTask.stale',
}

const STATE_MESSAGE: Record<BotTask['state'], string> = {
  running: 'docs.comment.botTask.runningHint',
  'no-reply': 'docs.comment.botTask.noReplyHint',
  applied: 'docs.comment.botTask.appliedHint',
  stale: 'docs.comment.botTask.staleHint',
}

export function AgentExecutionCard({
  task,
  names,
  onViewBotDiff,
  children,
}: {
  task: BotTask
  names?: Map<string, string>
  /**
   * Bot 那条回复的渲染结果,由宿主传进来(而不是这里直接读 task.reply.body)。
   *
   * 为什么绕这一手:宿主传的是真正的 <CommentBody>,于是这条回复的右键菜单(删除)、
   * 长文折叠、@ 渲染全都原样保留。如果这里自己渲染 body 文本,上面那些会全部丢掉 ——
   * 一条被搬进卡片的回复就变成了不能删、不能展开的死文本。
   *
   * 没传(或 task.reply 为空)时退回状态文案。
   */
  children?: ReactNode
  /**
   * 跳到版本记录去看这次改动。**可选,没给就不渲染按钮** —— 一个点了没反应的
   * 「查看 Diff」比没有按钮更糟。
   *
   * 带上定位信息(被 @ 的 Bot + 「根评论 → Bot 回复」的时间窗),宿主据此**直接打开**对应的
   * Diff。唯一命中才自动打开(pickBotEditVersion 判定),命中 0 个或多个就只是打开版本记录 ——
   * 猜错会把别人的改动展示成这条评论的结果,那是会让人据此做出错误判断的错。
   */
  onViewBotDiff?: (hint: BotDiffHint) => void
}) {
  const tone = botTaskTone(task.state)
  const name = names?.get(task.botUid) || task.botUid
  // 这两个状态要用户介入(核对正文 / 重发任务),文案走醒目的 callout 而不是普通段落。
  const needsAttention = task.state === 'stale' || task.state === 'no-reply'

  return (
    <section className="octo-agent-execution" aria-label={t('docs.comment.botTask.cardLabel')}>
      <header className="octo-agent-execution-header">
        <span className="octo-agent-avatar" aria-hidden="true">
          ✦
        </span>
        <span className="octo-agent-execution-title">
          <strong>{name}</strong>
          <small>{t('docs.comment.botTask.byline')}</small>
        </span>
        <span className={`octo-agent-status is-${tone}`}>{t(STATE_LABEL[task.state])}</span>
      </header>
      <div className="octo-agent-execution-body">
        {/* 引用原文变了要单独提醒:那是需要用户核对的事,不能被 Bot 的答复盖过去。 */}
        {/* stale / no-reply 用 callout,因为它们都要用户去做点什么(核对、重发),不是背景信息。 */}
        {needsAttention && (
          <div className="octo-agent-state-callout is-warning">{t(STATE_MESSAGE[task.state])}</div>
        )}
        {/* 有真回复就渲染真回复。
            没有回复时才退回状态文案 —— 但**上面已经用 callout 说过的就不再说第二遍**:
            实测「未见回复」那段话在 callout 和这里各渲染了一次,同一句话连着出现两遍。 */}
        {children ??
          (needsAttention ? null : (
            /* 有追问的串里 reply 是空的(提升会打乱时序,见 botTask.ts)。这时**不要**退回
               「Bot 已按这条评论修改了文档」那句空话 —— 它既没信息量,又是在替 Bot 总结。
               改成指路:告诉读者答复在下面按时间排着。还在跑的时候仍用 runningHint。 */
            <p>{t(task.state === 'running' ? STATE_MESSAGE.running : 'docs.comment.botTask.repliesBelow')}</p>
          ))}
      </div>
      {task.state !== 'running' && task.state !== 'no-reply' && onViewBotDiff && (
        <footer className="octo-agent-execution-actions">
          <button
            type="button"
            className="octo-tb-btn"
            onClick={() =>
              onViewBotDiff({
                botUid: task.botUid,
                fromISO: task.rootCreatedAt,
                toISO: task.reply?.createdAt ?? task.rootCreatedAt,
              })
            }
          >
            {t('docs.comment.botTask.viewDiff')}
          </button>
        </footer>
      )}
    </section>
  )
}
