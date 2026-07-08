// @octo/loop — Issue API（真实 fleet 联调）
import type {
  Issue,
  IssueComment,
  AgentTask,
  CreateIssueReq,
  UpdateIssueReq,
  ListParams,
  AssigneeCandidate,
} from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, listAssigneeCandidates as dirCandidates } from "./directory";

async function enrich(issues: Issue[]): Promise<Issue[]> {
  const dir = await ensureDirectory();
  return issues.map((i) => ({
    ...i,
    assignee_name: actorName(dir, i.assignee_type, i.assignee_id),
    creator_name: actorName(dir, i.creator_type ?? "member", i.creator_id),
    project_name: i.project_id ? dir.projectName.get(i.project_id) ?? null : null,
  }));
}

export async function listIssues(params?: ListParams): Promise<Issue[]> {
  const data = await httpGet<{ issues: Issue[]; total?: number }>("/issues", {
    keyword: params?.keyword,
  });
  return enrich(data.issues ?? []);
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

/* ---------- 评论 ---------- */
export async function listComments(issueId: string): Promise<IssueComment[]> {
  const [rows, dir] = await Promise.all([
    httpGet<IssueComment[]>(`/issues/${issueId}/comments`),
    ensureDirectory(),
  ]);
  return (rows ?? []).map((c) => ({
    ...c,
    author_name: actorName(dir, c.author_type, c.author_id) ?? c.author_id,
  }));
}

export function addComment(
  issueId: string,
  content: string,
  parentId: string | null = null,
): Promise<IssueComment> {
  return httpPost<IssueComment>(`/issues/${issueId}/comments`, {
    content,
    parent_id: parentId ?? undefined,
  });
}

export function deleteComment(commentId: string): Promise<void> {
  return httpDelete<void>(`/comments/${commentId}`);
}

/* ---------- 执行日志 ---------- */
export async function listTasks(issueId: string): Promise<AgentTask[]> {
  const [rows, dir] = await Promise.all([
    httpGet<AgentTask[]>(`/issues/${issueId}/tasks`).catch(() => [] as AgentTask[]),
    ensureDirectory(),
  ]);
  return (rows ?? []).map((tk) => ({
    ...tk,
    agent_name: tk.agent_id ? dir.agentName.get(tk.agent_id) ?? null : null,
  }));
}

/* ---------- 指派候选 ---------- */
export function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  return dirCandidates();
}
