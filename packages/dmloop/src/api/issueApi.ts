// @octo/loop — Issue API（后端契约联调）
import type {
  Issue,
  IssueComment,
  CreateIssueReq,
  UpdateIssueReq,
  ListParams,
  GroupedParams,
  IssueGroup,
  AgentTaskSnapshotItem,
  AssigneeCandidate,
  IssueTriggerPreview,
  IssueTriggerPreviewParams,
  CommentTriggerAgent,
} from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar, listAssigneeCandidates as dirCandidates } from "./directory";
import { arrayFilterQuery } from "./issueFilterQuery";

// enrich 的同步核心:调用方已拿到 directory 时复用,避免每组重复 ensureDirectory。
function enrichWith(dir: Awaited<ReturnType<typeof ensureDirectory>>, issues: Issue[]): Issue[] {
  return issues.map((i) => ({
    ...i,
    assignee_name: actorName(dir, i.assignee_type, i.assignee_id),
    creator_name: actorName(dir, i.creator_type ?? "member", i.creator_id),
    assignee_avatar: actorAvatar(dir, i.assignee_type, i.assignee_id),
    creator_avatar: actorAvatar(dir, i.creator_type ?? "member", i.creator_id),
    project_name: i.project_id ? dir.projectName.get(i.project_id) ?? null : null,
  }));
}

async function enrich(issues: Issue[]): Promise<Issue[]> {
  const dir = await ensureDirectory();
  return enrichWith(dir, issues);
}

// 拉取 issue 列表并 enrich + 兜底 total(listIssues/searchIssues 共用尾巴)。
async function fetchIssues(path: string, query: Record<string, unknown>): Promise<{ issues: Issue[]; total: number }> {
  const data = await httpGet<{ issues: Issue[]; total?: number }>(path, query);
  const issues = await enrich(data.issues ?? []);
  return { issues, total: data.total ?? issues.length };
}

export function listIssues(params?: ListParams): Promise<{ issues: Issue[]; total: number }> {
  return fetchIssues("/issues", {
    ...arrayFilterQuery(params ?? {}),
    date_field: params?.date_field,
    date_start: params?.date_start,
    date_end: params?.date_end,
    limit: params?.limit,
    offset: params?.offset,
  });
}

// 关键词搜索(GET /issues/search):独立端点,后端全文搜标题/描述/评论并回高亮片段。
// 与 listIssues 是两套语义(不吃状态/优先级等筛选、limit≤50),故单列一个函数。
export function searchIssues(
  q: string,
  opts?: { limit?: number; offset?: number; includeClosed?: boolean },
): Promise<{ issues: Issue[]; total: number }> {
  return fetchIssues("/issues/search", {
    q,
    limit: opts?.limit,
    offset: opts?.offset,
    include_closed: opts?.includeClosed ? "true" : undefined,
  });
}

export async function enrichIssue(issue: Issue): Promise<Issue> {
  return (await enrich([issue]))[0];
}

export async function getIssue(id: string): Promise<Issue> {
  const issue = await httpGet<Issue>(`/issues/${encodeURIComponent(id)}`);
  return enrichIssue(issue);
}

export async function resolveIssueByIdentifier(identifier: string): Promise<Issue | null> {
  const key = identifier.trim();
  if (!key) return null;

  const direct = await getIssue(key).catch(() => null);
  if (direct?.identifier?.toLowerCase() === key.toLowerCase()) return direct;

  const searched = await searchIssues(key, { limit: 50, includeClosed: true }).catch(
    () => ({ issues: [] as Issue[], total: 0 })
  );
  return (
    searched.issues.find((issue) => issue.identifier.toLowerCase() === key.toLowerCase()) ??
    null
  );
}

// 子 issue 列表(GET /issues/:id/children):后端包裹 { issues }。子项含 status,
// 进度(done/total)由页面本地算,不再调批量 /child-progress(那是列表/看板用的)。
export async function listChildren(id: string): Promise<Issue[]> {
  const data = await httpGet<{ issues?: Issue[] }>(`/issues/${id}/children`);
  return enrich(data?.issues ?? []);
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

// 按负责人分组板(GET /issues/grouped,group_by 固定 assignee)。scope pill 通过
// assignee_types / involves_user_id 收窄。一次拿 directory 供全部分组同步 enrich +
// 回填分组头负责人名(未指派组 assignee_type=null → actorName 返回 null)。
export async function listGroupedIssues(params: GroupedParams): Promise<IssueGroup[]> {
  const dir = await ensureDirectory();
  const data = await httpGet<{ groups?: IssueGroup[] }>("/issues/grouped", {
    group_by: "assignee",
    ...arrayFilterQuery(params),
    assignee_id: params.assignee_id,
    involves_user_id: params.involves_user_id,
    creator_id: params.creator_id,
    project_id: params.project_id,
    date_field: params.date_field,
    date_start: params.date_start,
    date_end: params.date_end,
    limit: params.limit,
  });
  return (data.groups ?? []).map((g) => ({
    ...g,
    issues: enrichWith(dir, g.issues ?? []),
    assignee_name: actorName(dir, g.assignee_type, g.assignee_id),
    assignee_avatar: actorAvatar(dir, g.assignee_type, g.assignee_id),
  }));
}

// 「与我相关」= 后端三个单用户过滤的并集(assignee_id / creator_id / involves_user_id)。
// 后端 involves_user_id 按设计**不含**直接指派/创建(仅间接:我拥有的 agent、我所在 squad),
// 故只发它会漏掉「指派给我」「我创建」的 issue。后端无跨用户 OR → 并行拉三次,按
// (assignee_type, assignee_id) 合并分组、按 issue id 去重,total 取去重后条数。
// 对齐后端「我的 issue」三过滤并集语义(assignee_types 对本 scope 无意义,剥离)。
export async function listMyGroupedIssues(userId: string, params: GroupedParams): Promise<IssueGroup[]> {
  // 剥离所有「用户关系」过滤(单值 + 复数):三 leg 各自设一个,base 保留任何一个都会污染另两 leg
  // (如 creator 下拉会在其余 leg 变成意外 AND)。复数 assignee_ids/creator_ids 同理必须剥,
  // 否则 My Loop 面板选的负责人/创建者会 AND 进三腿、破坏并集语义。assignee_types 对本 scope 无意义。
  const base: GroupedParams = {
    ...params,
    assignee_types: undefined,
    assignee_id: undefined, assignee_ids: undefined,
    creator_id: undefined, creator_ids: undefined,
    involves_user_id: undefined,
  };
  const variants: GroupedParams[] = [
    { ...base, assignee_id: userId },
    { ...base, creator_id: userId },
    { ...base, involves_user_id: userId },
  ];
  const results = await Promise.all(variants.map(listGroupedIssues));
  const key = (g: IssueGroup) => `${g.assignee_type ?? "_"}::${g.assignee_id ?? "_"}`;
  const merged = new Map<string, IssueGroup>();
  for (const groups of results) {
    for (const g of groups) {
      const existing = merged.get(key(g));
      if (!existing) {
        merged.set(key(g), { ...g, issues: [...g.issues], total: g.issues.length });
        continue;
      }
      const seen = new Set(existing.issues.map((i) => i.id));
      for (const issue of g.issues) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        existing.issues.push(issue);
      }
      existing.total = existing.issues.length;
    }
  }
  return [...merged.values()];
}

// 批量改(POST /issues/batch-update)：同一 updates 应用到多个 issue,返回受影响数。
export function batchUpdateIssues(issueIds: string[], updates: UpdateIssueReq): Promise<{ updated: number }> {
  return httpPost<{ updated: number }>("/issues/batch-update", { issue_ids: issueIds, updates });
}

// 批量删(POST /issues/batch-delete)。
export function batchDeleteIssues(issueIds: string[]): Promise<{ deleted: number }> {
  return httpPost<{ deleted: number }>("/issues/batch-delete", { issue_ids: issueIds });
}

// 工作区级运行中任务快照(GET /agent-task-snapshot,裸数组)。调用方一遍扫出
// 「有 agent 正在跑」的 issue-id 集合,喂给卡片渲染 running chip(非 per-card,无 N+1)。
export function getAgentTaskSnapshot(): Promise<AgentTaskSnapshotItem[]> {
  return httpGet<AgentTaskSnapshotItem[]>("/agent-task-snapshot");
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
