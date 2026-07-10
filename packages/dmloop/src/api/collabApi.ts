// @octo/loop — 协作 API(订阅 + 评论 emoji 反应,后端契约联调)。
import type { IssueSubscriber } from "./types";
import { httpGet, httpPost, httpDelete } from "./http";

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
