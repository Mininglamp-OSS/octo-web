// @octo/loop — Issue API (Mock)
// 契约对齐 Loop issue 域：list/get/create/update/delete + quickCreate/batchUpdate + comments。
import type {
  Issue,
  IssueComment,
  CreateIssueReq,
  UpdateIssueReq,
  ListParams,
  AssigneeCandidate,
} from "./types";
import { resolveWorkspaceId } from "./types";
import { store, nextId, sleep, clone } from "./mockStore";
import { CANDIDATES } from "./mock/seed";

export async function listIssues(params?: ListParams): Promise<Issue[]> {
  await sleep();
  const ws = resolveWorkspaceId(params?.workspace_id);
  let rows = store.issues.filter((i) => i.workspace_id === ws);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) {
    rows = rows.filter(
      (i) =>
        i.title.toLowerCase().includes(kw) ||
        i.identifier.toLowerCase().includes(kw),
    );
  }
  return clone(rows.sort((a, b) => a.position - b.position));
}

export async function getIssue(id: string): Promise<Issue | null> {
  await sleep(120);
  const row = store.issues.find((i) => i.id === id);
  return row ? clone(row) : null;
}

export async function createIssue(req: CreateIssueReq): Promise<Issue> {
  await sleep();
  const ws = resolveWorkspaceId();
  const number =
    store.issues.reduce((m, i) => Math.max(m, i.number), 0) + 1;
  const cand = req.assignee_id
    ? CANDIDATES.find((c) => c.id === req.assignee_id)
    : undefined;
  const nowIso = new Date().toISOString();
  const issue: Issue = {
    id: nextId("i"),
    workspace_id: ws,
    number,
    identifier: `LOOP-${number}`,
    title: req.title,
    description: req.description ?? null,
    status: req.status ?? "todo",
    priority: req.priority ?? "none",
    assignee_type: cand?.type ?? req.assignee_type ?? null,
    assignee_id: req.assignee_id ?? null,
    assignee_name: cand?.name ?? null,
    creator_id: "u-1",
    creator_name: "lvsijia",
    project_id: req.project_id ?? null,
    project_name: req.project_id
      ? store.projects.find((p) => p.id === req.project_id)?.title ?? null
      : null,
    position: store.issues.length,
    start_date: null,
    due_date: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.issues.push(issue);
  return clone(issue);
}

/** quick-create：以自然语言 prompt 快速建单（对齐 Loop quick-create 契约）。 */
export async function quickCreateIssue(prompt: string): Promise<Issue> {
  return createIssue({ title: prompt.slice(0, 200), status: "todo" });
}

export async function updateIssue(
  id: string,
  req: UpdateIssueReq,
): Promise<Issue> {
  await sleep(120);
  const row = store.issues.find((i) => i.id === id);
  if (!row) throw new Error("issue not found");
  if (req.title !== undefined) row.title = req.title;
  if (req.description !== undefined) row.description = req.description;
  if (req.status !== undefined) row.status = req.status;
  if (req.priority !== undefined) row.priority = req.priority;
  if (req.position !== undefined) row.position = req.position;
  if (req.assignee_id !== undefined) {
    const cand = req.assignee_id
      ? CANDIDATES.find((c) => c.id === req.assignee_id)
      : undefined;
    row.assignee_id = req.assignee_id;
    row.assignee_type = cand?.type ?? req.assignee_type ?? null;
    row.assignee_name = cand?.name ?? null;
  }
  if (req.project_id !== undefined) {
    row.project_id = req.project_id;
    row.project_name = req.project_id
      ? store.projects.find((p) => p.id === req.project_id)?.title ?? null
      : null;
  }
  row.updated_at = new Date().toISOString();
  return clone(row);
}

/** batch-update：批量更新（对齐 Loop batch-update 契约）。 */
export async function batchUpdateIssues(
  ids: string[],
  updates: UpdateIssueReq,
): Promise<number> {
  await sleep();
  let n = 0;
  for (const id of ids) {
    try {
      await updateIssue(id, updates);
      n += 1;
    } catch {
      /* skip missing */
    }
  }
  return n;
}

export async function deleteIssue(id: string): Promise<void> {
  await sleep(120);
  store.issues = store.issues.filter((i) => i.id !== id);
  store.comments = store.comments.filter((c) => c.issue_id !== id);
}

/* ---------- 评论 ---------- */

export async function listComments(issueId: string): Promise<IssueComment[]> {
  await sleep(100);
  return clone(
    store.comments
      .filter((c) => c.issue_id === issueId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
}

export async function addComment(
  issueId: string,
  content: string,
  parentId: string | null = null,
): Promise<IssueComment> {
  await sleep(120);
  const comment: IssueComment = {
    id: nextId("c"),
    issue_id: issueId,
    parent_id: parentId,
    author_type: "member",
    author_id: "u-1",
    author_name: "lvsijia",
    content,
    created_at: new Date().toISOString(),
  };
  store.comments.push(comment);
  return clone(comment);
}

export async function deleteComment(commentId: string): Promise<void> {
  await sleep(100);
  // 删除评论及其直接回复。
  store.comments = store.comments.filter(
    (c) => c.id !== commentId && c.parent_id !== commentId,
  );
}

/* ---------- 指派候选 ---------- */

export async function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  await sleep(60);
  return clone(CANDIDATES);
}
