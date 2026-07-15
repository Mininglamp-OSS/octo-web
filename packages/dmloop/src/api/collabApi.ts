// @octo/loop — 协作 API(订阅 + 评论/issue 反应 + 评论 resolve + 时间线,后端契约联调)。
import type { IssueSubscriber, TimelineEntry, AssigneeType } from "./types";
import { httpGet, httpPost, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar } from "./directory";

/* ---------- 订阅 ---------- */
// subscribe/unsubscribe 均为 POST(不是 DELETE),body 可空 → 默认操作调用者本人;后端幂等。
export function listSubscribers(issueId: string): Promise<IssueSubscriber[]> {
  return httpGet<IssueSubscriber[]>(`/issues/${issueId}/subscribers`).then((r) => r ?? []);
}
export function subscribeIssue(issueId: string): Promise<void> {
  return httpPost<void>(`/issues/${issueId}/subscribe`);
}
export function unsubscribeIssue(issueId: string): Promise<void> {
  return httpPost<void>(`/issues/${issueId}/unsubscribe`);
}

/* ---------- 评论 emoji 反应 ---------- */
// body 为 { emoji };删除也带 body,后端按 (actor, emoji) 定位并只删调用者自己那条。
export function addCommentReaction(commentId: string, emoji: string): Promise<void> {
  return httpPost<void>(`/comments/${commentId}/reactions`, { emoji });
}
export function removeCommentReaction(commentId: string, emoji: string): Promise<void> {
  return httpDelete<void>(`/comments/${commentId}/reactions`, { emoji });
}

/* ---------- issue 级 emoji 反应 ---------- */
// 与评论反应同形(body { emoji }、按 actor+emoji 定位);读回走 GetIssue 的 issue.reactions。
export function addIssueReaction(issueId: string, emoji: string): Promise<void> {
  return httpPost<void>(`/issues/${issueId}/reactions`, { emoji });
}
export function removeIssueReaction(issueId: string, emoji: string): Promise<void> {
  return httpDelete<void>(`/issues/${issueId}/reactions`, { emoji });
}

/* ---------- 评论 resolve / unresolve ---------- */
// POST/DELETE /comments/:id/resolve(无 body,返回该评论)。后端「一线程至多一条 resolved」,
// resolve 一条会清同线程兄弟 → 调用方 resolve/unresolve 后重拉评论列表即可。
export function resolveComment(commentId: string): Promise<void> {
  return httpPost<void>(`/comments/${commentId}/resolve`);
}
export function unresolveComment(commentId: string): Promise<void> {
  return httpDelete<void>(`/comments/${commentId}/resolve`);
}

/* ---------- 时间线 ---------- */
// GET /issues/:id/timeline 不带分页参数 → 裸数组(ASC),合并 comment + activity。
// 回填 actor 展示名/头像(directory 缓存);页面活动流只取 type==="activity"。
export async function listTimeline(issueId: string): Promise<TimelineEntry[]> {
  const [rows, dir] = await Promise.all([
    httpGet<TimelineEntry[]>(`/issues/${issueId}/timeline`),
    ensureDirectory(),
  ]);
  return (rows ?? []).map((e) => ({
    ...e,
    // actor_type 为 string(活动可能是 member/agent/squad/system 等);actorName 对未知有兜底。
    actor_name: actorName(dir, e.actor_type as AssigneeType, e.actor_id),
    actor_avatar: actorAvatar(dir, e.actor_type as AssigneeType, e.actor_id),
  }));
}
