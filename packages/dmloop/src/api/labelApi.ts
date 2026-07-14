// @octo/loop — 标签 API（后端契约联调）。
// 工作区级标签 CRUD(/labels) + issue 挂/摘标签(/issues/:id/labels)。
import type { IssueLabel } from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";

/* ---------- 工作区标签 CRUD ---------- */
// 后端 list 端点返回 { labels: [...], total }(包裹,同 /issues);解包取 labels。
export function listLabels(): Promise<IssueLabel[]> {
  return httpGet<{ labels?: IssueLabel[] }>("/labels").then((r) => r?.labels ?? []);
}

export function createLabel(name: string, color: string): Promise<IssueLabel> {
  return httpPost<IssueLabel>("/labels", { name, color });
}

export function updateLabel(id: string, req: { name?: string; color?: string }): Promise<IssueLabel> {
  return httpPut<IssueLabel>(`/labels/${id}`, req);
}

export function deleteLabel(id: string): Promise<void> {
  return httpDelete<void>(`/labels/${id}`);
}

/* ---------- issue ↔ 标签 ---------- */
export function listIssueLabels(issueId: string): Promise<IssueLabel[]> {
  return httpGet<{ labels?: IssueLabel[] }>(`/issues/${issueId}/labels`).then((r) => r?.labels ?? []);
}

// 后端 POST /issues/:id/labels 体为 { label_id }。
export function attachLabel(issueId: string, labelId: string): Promise<void> {
  return httpPost<void>(`/issues/${issueId}/labels`, { label_id: labelId });
}

export function detachLabel(issueId: string, labelId: string): Promise<void> {
  return httpDelete<void>(`/issues/${issueId}/labels/${labelId}`);
}
