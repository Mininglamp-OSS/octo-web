// @octo/loop — Issue API（后端契约联调）
import type {
  Issue,
  IssueComment,
  CreateIssueReq,
  UpdateIssueReq,
  ListParams,
  AssigneeCandidate,
  IssueTriggerPreview,
  IssueTriggerPreviewParams,
  CommentTriggerAgent,
} from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar, listAssigneeCandidates as dirCandidates } from "./directory";

async function enrich(issues: Issue[]): Promise<Issue[]> {
  const dir = await ensureDirectory();
  return issues.map((i) => ({
    ...i,
    assignee_name: actorName(dir, i.assignee_type, i.assignee_id),
    creator_name: actorName(dir, i.creator_type ?? "member", i.creator_id),
    assignee_avatar: actorAvatar(dir, i.assignee_type, i.assignee_id),
    creator_avatar: actorAvatar(dir, i.creator_type ?? "member", i.creator_id),
    project_name: i.project_id ? dir.projectName.get(i.project_id) ?? null : null,
  }));
}

export async function listIssues(
  params?: ListParams,
): Promise<{ issues: Issue[]; total: number }> {
  const data = await httpGet<{ issues: Issue[]; total?: number }>("/issues", {
    keyword: params?.keyword,
    status: params?.status,
    priority: params?.priority,
    assignee_id: params?.assignee_id,
    creator_id: params?.creator_id,
    project_id: params?.project_id,
    sort: params?.sort_by,
    direction: params?.sort_direction,
    limit: params?.limit,
    offset: params?.offset,
  });
  const issues = await enrich(data.issues ?? []);
  return { issues, total: data.total ?? issues.length };
}

export async function getIssue(id: string): Promise<Issue> {
  const issue = await httpGet<Issue>(`/issues/${id}`);
  return (await enrich([issue]))[0];
}

export function createIssue(req: CreateIssueReq): Promise<Issue> {
  return httpPost<Issue>("/issues", req);
}

export function updateIssue(id: string, req: UpdateIssueReq): Promise<Issue> {
  return httpPut<Issue>(`/issues/${id}`, req);
}

export function deleteIssue(id: string): Promise<void> {
  return httpDelete<void>(`/issues/${id}`);
}

// 派单预触发（只读）：问后端“这次指派/状态变更会不会起 run、谁跑”。绝不前端猜。
export function previewIssueTrigger(params: IssueTriggerPreviewParams): Promise<IssueTriggerPreview> {
  return httpPost<IssueTriggerPreview>("/issues/preview-trigger", params);
}

/* ---------- 评论 ---------- */
export async function listComments(issueId: string): Promise<IssueComment[]> {
  const [rows, dir] = await Promise.all([
    httpGet<IssueComment[]>(`/issues/${issueId}/comments`),
    ensureDirectory(),
  ]);
  return (rows ?? []).map((c) => ({
    ...c,
    author_name: actorName(dir, c.author_type, c.author_id) ?? c.author_id,
    author_avatar: actorAvatar(dir, c.author_type, c.author_id),
  }));
}

export function addComment(
  issueId: string,
  content: string,
  parentId: string | null = null,
  suppressAgentIds: string[] = [],
): Promise<IssueComment> {
  return httpPost<IssueComment>(`/issues/${issueId}/comments`, {
    content,
    parent_id: parentId ?? undefined,
    suppress_agent_ids: suppressAgentIds.length ? suppressAgentIds : undefined,
  });
}

// 评论派单预览（只读）：这条评论会唤醒哪些 agent（issue 负责人 / @提及）。绝不前端猜。
export function previewCommentTriggers(
  issueId: string,
  content: string,
  parentId: string | null = null,
): Promise<CommentTriggerAgent[]> {
  return httpPost<{ agents?: CommentTriggerAgent[] }>(`/issues/${issueId}/comments/trigger-preview`, {
    content,
    parent_id: parentId ?? undefined,
  }).then((r) => r.agents ?? []);
}

export function deleteComment(commentId: string): Promise<void> {
  return httpDelete<void>(`/comments/${commentId}`);
}

// 编辑评论：仅作者或 workspace owner/admin 可改（后端 PUT /comments/:id 强校验）。
export function updateComment(commentId: string, content: string): Promise<IssueComment> {
  return httpPut<IssueComment>(`/comments/${commentId}`, { content });
}

/* ---------- 指派候选 ---------- */
export function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  return dirCandidates();
}
