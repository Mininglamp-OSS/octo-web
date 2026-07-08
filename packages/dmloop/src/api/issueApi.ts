// @octo/loop — Issue API（真实 HTTP，路径对齐 multica REST 契约；本版命中 MSW mock）
import type {
  Issue,
  IssueComment,
  AgentTask,
  CreateIssueReq,
  UpdateIssueReq,
  ListParams,
  AssigneeCandidate,
} from "./types";
import { httpGet, httpPost, httpPut, httpDelete, currentWorkspaceId } from "./http";

export async function listIssues(params?: ListParams): Promise<Issue[]> {
  const data = await httpGet<{ issues: Issue[]; total: number }>("/issues", {
    workspace_id: params?.workspace_id ?? currentWorkspaceId(),
    keyword: params?.keyword,
  });
  return data.issues;
}

export function getIssue(id: string): Promise<Issue> {
  return httpGet<Issue>(`/issues/${id}`);
}

export function createIssue(req: CreateIssueReq): Promise<Issue> {
  return httpPost<Issue>("/issues", req);
}

export function quickCreateIssue(prompt: string): Promise<Issue> {
  return httpPost<Issue>("/issues/quick-create", { prompt });
}

export function updateIssue(id: string, req: UpdateIssueReq): Promise<Issue> {
  return httpPut<Issue>(`/issues/${id}`, req);
}

export async function batchUpdateIssues(
  ids: string[],
  updates: UpdateIssueReq,
): Promise<number> {
  const data = await httpPost<{ updated: number }>("/issues/batch-update", {
    issue_ids: ids,
    updates,
  });
  return data.updated;
}

export function deleteIssue(id: string): Promise<void> {
  return httpDelete<void>(`/issues/${id}`);
}

/* ---------- 评论 ---------- */
export function listComments(issueId: string): Promise<IssueComment[]> {
  return httpGet<IssueComment[]>(`/issues/${issueId}/comments`);
}

export function addComment(
  issueId: string,
  content: string,
  parentId: string | null = null,
): Promise<IssueComment> {
  return httpPost<IssueComment>(`/issues/${issueId}/comments`, {
    content,
    parent_id: parentId,
  });
}

export function deleteComment(commentId: string): Promise<void> {
  return httpDelete<void>(`/comments/${commentId}`);
}

/* ---------- 执行日志 ---------- */
export function listTasks(issueId: string): Promise<AgentTask[]> {
  return httpGet<AgentTask[]>(`/issues/${issueId}/tasks`);
}

/* ---------- 指派候选（member/agent/squad 三态） ---------- */
export function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  return httpGet<AssigneeCandidate[]>("/assignee-candidates");
}
