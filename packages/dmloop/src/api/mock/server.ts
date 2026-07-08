// @octo/loop — MSW handlers（Mock 命中真实网络请求，DevTools Network 可见）
// 路径与 multica REST 契约对齐；响应体来自内存 store。摘掉本层即可直连 multica-server。
import { http, HttpResponse, delay } from "msw";
import { setupWorker } from "msw/browser";
import type { SetupWorker } from "msw/browser";
import type { RequestHandler } from "msw";
import { LOOP_API_BASE } from "../http";
import { store, nextId, clone } from "../mockStore";
import { CANDIDATES } from "./seed";
import type {
  Issue,
  IssueComment,
  CreateIssueReq,
  UpdateIssueReq,
  UpsertSkillReq,
  UpsertProjectReq,
  UpsertAgentReq,
  UpsertSquadReq,
  AssigneeType,
} from "../types";

const B = LOOP_API_BASE;
const nowIso = () => new Date().toISOString();

function candName(id?: string | null): string | null {
  if (!id) return null;
  return CANDIDATES.find((c) => c.id === id)?.name ?? null;
}
function candType(id?: string | null): AssigneeType | null {
  if (!id) return null;
  return CANDIDATES.find((c) => c.id === id)?.type ?? null;
}

function filterByWs<T extends { workspace_id: string }>(
  rows: T[],
  url: URL,
): T[] {
  const ws = url.searchParams.get("workspace_id");
  return ws ? rows.filter((r) => r.workspace_id === ws) : rows;
}
function byKeyword<T>(rows: T[], url: URL, fields: (r: T) => string[]): T[] {
  const kw = url.searchParams.get("keyword")?.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => fields(r).some((f) => f.toLowerCase().includes(kw)));
}

export const loopHandlers: RequestHandler[] = [
  /* ---------- workspaces ---------- */
  http.get(`${B}/workspaces`, async () => {
    await delay(120);
    return HttpResponse.json(clone(store.workspaces));
  }),

  /* ---------- assignee 候选：members / agents / squads ---------- */
  http.get(`${B}/members`, async () => {
    await delay(80);
    return HttpResponse.json(clone(CANDIDATES.filter((c) => c.type === "member")));
  }),
  http.get(`${B}/assignee-candidates`, async () => {
    await delay(80);
    return HttpResponse.json(clone(CANDIDATES));
  }),

  /* ---------- issues ---------- */
  http.get(`${B}/issues`, async ({ request }) => {
    await delay(140);
    const url = new URL(request.url);
    let rows = filterByWs(store.issues, url);
    rows = byKeyword(rows, url, (i) => [i.title, i.identifier]);
    rows = [...rows].sort((a, b) => a.position - b.position);
    return HttpResponse.json({ issues: clone(rows), total: rows.length });
  }),
  http.get(`${B}/issues/:id`, async ({ params }) => {
    await delay(100);
    const row = store.issues.find((i) => i.id === params.id);
    return row ? HttpResponse.json(clone(row)) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${B}/issues`, async ({ request }) => {
    await delay(140);
    const req = (await request.json()) as CreateIssueReq;
    const number = store.issues.reduce((m, i) => Math.max(m, i.number), 0) + 1;
    const issue: Issue = {
      id: nextId("i"),
      workspace_id: "ws-loop-demo",
      number,
      identifier: `LOOP-${number}`,
      title: req.title,
      description: req.description ?? null,
      status: req.status ?? "todo",
      priority: req.priority ?? "none",
      assignee_type: candType(req.assignee_id) ?? req.assignee_type ?? null,
      assignee_id: req.assignee_id ?? null,
      assignee_name: candName(req.assignee_id),
      creator_id: "u-1",
      creator_name: "lvsijia",
      project_id: req.project_id ?? null,
      project_name: req.project_id
        ? store.projects.find((p) => p.id === req.project_id)?.title ?? null
        : null,
      position: store.issues.length,
      start_date: null,
      due_date: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.issues.push(issue);
    return HttpResponse.json(clone(issue), { status: 201 });
  }),
  http.post(`${B}/issues/quick-create`, async ({ request }) => {
    await delay(140);
    const { prompt } = (await request.json()) as { prompt: string };
    const number = store.issues.reduce((m, i) => Math.max(m, i.number), 0) + 1;
    const issue: Issue = {
      id: nextId("i"), workspace_id: "ws-loop-demo", number,
      identifier: `LOOP-${number}`, title: (prompt || "").slice(0, 200),
      description: null, status: "todo", priority: "none",
      assignee_type: null, assignee_id: null, assignee_name: null,
      creator_id: "u-1", creator_name: "lvsijia", project_id: null,
      project_name: null, position: store.issues.length,
      start_date: null, due_date: null, created_at: nowIso(), updated_at: nowIso(),
    };
    store.issues.push(issue);
    return HttpResponse.json(clone(issue), { status: 201 });
  }),
  http.post(`${B}/issues/batch-update`, async ({ request }) => {
    await delay(140);
    const { issue_ids, updates } = (await request.json()) as {
      issue_ids: string[]; updates: UpdateIssueReq;
    };
    let updated = 0;
    for (const id of issue_ids) {
      const row = store.issues.find((i) => i.id === id);
      if (row) { applyIssueUpdate(row, updates); updated += 1; }
    }
    return HttpResponse.json({ updated });
  }),
  http.put(`${B}/issues/:id`, async ({ params, request }) => {
    await delay(100);
    const row = store.issues.find((i) => i.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    applyIssueUpdate(row, (await request.json()) as UpdateIssueReq);
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/issues/:id`, async ({ params }) => {
    await delay(100);
    store.issues = store.issues.filter((i) => i.id !== params.id);
    store.comments = store.comments.filter((c) => c.issue_id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------- comments ---------- */
  http.get(`${B}/issues/:id/comments`, async ({ params }) => {
    await delay(90);
    const rows = store.comments
      .filter((c) => c.issue_id === params.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return HttpResponse.json(clone(rows));
  }),
  http.post(`${B}/issues/:id/comments`, async ({ params, request }) => {
    await delay(120);
    const body = (await request.json()) as { content: string; parent_id?: string | null };
    const comment: IssueComment = {
      id: nextId("c"),
      issue_id: String(params.id),
      parent_id: body.parent_id ?? null,
      author_type: "member",
      author_id: "u-1",
      author_name: "lvsijia",
      content: body.content,
      created_at: nowIso(),
    };
    store.comments.push(comment);
    return HttpResponse.json(clone(comment), { status: 201 });
  }),
  http.delete(`${B}/comments/:id`, async ({ params }) => {
    await delay(90);
    store.comments = store.comments.filter(
      (c) => c.id !== params.id && c.parent_id !== params.id,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------- execution log (tasks) ---------- */
  http.get(`${B}/issues/:id/tasks`, async ({ params }) => {
    await delay(110);
    const rows = store.tasks
      .filter((t) => t.issue_id === params.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return HttpResponse.json(clone(rows));
  }),

  /* ---------- skills ---------- */
  http.get(`${B}/skills`, async ({ request }) => {
    await delay(130);
    const url = new URL(request.url);
    let rows = filterByWs(store.skills, url);
    rows = byKeyword(rows, url, (s) => [s.name, s.description]);
    return HttpResponse.json(clone(rows));
  }),
  http.get(`${B}/skills/:id`, async ({ params }) => {
    await delay(90);
    const row = store.skills.find((s) => s.id === params.id);
    return row ? HttpResponse.json(clone(row)) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${B}/skills`, async ({ request }) => {
    await delay(130);
    const req = (await request.json()) as UpsertSkillReq;
    const row = {
      id: nextId("sk"), workspace_id: "ws-loop-demo", name: req.name,
      description: req.description ?? "", source: req.source ?? "workspace",
      content: req.content ?? "", used_by: 0, creator_name: "lvsijia",
      created_at: nowIso(), updated_at: nowIso(),
    };
    store.skills.push(row);
    return HttpResponse.json(clone(row), { status: 201 });
  }),
  http.post(`${B}/skills/import`, async ({ request }) => {
    await delay(160);
    const { url: srcUrl } = (await request.json()) as { url: string };
    const name = (srcUrl || "imported-skill").split("/").filter(Boolean).pop() ?? "imported-skill";
    const row = {
      id: nextId("sk"), workspace_id: "ws-loop-demo", name,
      description: "Imported from " + srcUrl, source: "github" as const,
      content: "# " + name, used_by: 0, creator_name: "lvsijia",
      created_at: nowIso(), updated_at: nowIso(),
    };
    store.skills.push(row);
    return HttpResponse.json(clone(row), { status: 201 });
  }),
  http.put(`${B}/skills/:id`, async ({ params, request }) => {
    await delay(100);
    const row = store.skills.find((s) => s.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const req = (await request.json()) as UpsertSkillReq;
    row.name = req.name;
    if (req.description !== undefined) row.description = req.description;
    if (req.source !== undefined) row.source = req.source;
    if (req.content !== undefined) row.content = req.content;
    row.updated_at = nowIso();
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/skills/:id`, async ({ params }) => {
    await delay(90);
    store.skills = store.skills.filter((s) => s.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------- projects ---------- */
  http.get(`${B}/projects`, async ({ request }) => {
    await delay(130);
    const url = new URL(request.url);
    let rows = filterByWs(store.projects, url);
    rows = byKeyword(rows, url, (p) => [p.title]);
    return HttpResponse.json({ projects: clone(rows), total: rows.length });
  }),
  http.get(`${B}/projects/:id`, async ({ params }) => {
    await delay(90);
    const row = store.projects.find((p) => p.id === params.id);
    return row ? HttpResponse.json(clone(row)) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${B}/projects`, async ({ request }) => {
    await delay(130);
    const req = (await request.json()) as UpsertProjectReq;
    const row = {
      id: nextId("p"), workspace_id: "ws-loop-demo", title: req.title,
      description: req.description ?? null, icon: req.icon ?? "📁",
      status: req.status ?? "planned", priority: req.priority ?? "none",
      lead_type: req.lead_type ?? null, lead_id: req.lead_id ?? null,
      lead_name: candName(req.lead_id), issue_count: 0, done_count: 0,
      created_at: nowIso(), updated_at: nowIso(),
    };
    store.projects.push(row);
    return HttpResponse.json(clone(row), { status: 201 });
  }),
  http.put(`${B}/projects/:id`, async ({ params, request }) => {
    await delay(100);
    const row = store.projects.find((p) => p.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const req = (await request.json()) as UpsertProjectReq;
    row.title = req.title;
    if (req.description !== undefined) row.description = req.description;
    if (req.icon !== undefined) row.icon = req.icon;
    if (req.status !== undefined) row.status = req.status;
    if (req.priority !== undefined) row.priority = req.priority;
    if (req.lead_type !== undefined) row.lead_type = req.lead_type;
    if (req.lead_id !== undefined) { row.lead_id = req.lead_id; row.lead_name = candName(req.lead_id); }
    row.updated_at = nowIso();
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/projects/:id`, async ({ params }) => {
    await delay(90);
    store.projects = store.projects.filter((p) => p.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------- agents ---------- */
  http.get(`${B}/agents`, async ({ request }) => {
    await delay(130);
    const url = new URL(request.url);
    let rows = filterByWs(store.agents, url);
    rows = byKeyword(rows, url, (a) => [a.name, a.description]);
    return HttpResponse.json(clone(rows));
  }),
  http.get(`${B}/agents/:id/env`, async ({ params }) => {
    await delay(90);
    return HttpResponse.json({ custom_env: clone(store.agentEnv[String(params.id)] ?? {}) });
  }),
  http.put(`${B}/agents/:id/env`, async ({ params, request }) => {
    await delay(110);
    const { custom_env } = (await request.json()) as { custom_env: Record<string, string> };
    store.agentEnv[String(params.id)] = { ...custom_env };
    return HttpResponse.json({ custom_env: clone(store.agentEnv[String(params.id)]) });
  }),
  http.get(`${B}/agents/:id/skills`, async ({ params }) => {
    await delay(80);
    const a = store.agents.find((x) => x.id === params.id);
    return HttpResponse.json(clone(a?.skills ?? []));
  }),
  http.put(`${B}/agents/:id/skills`, async ({ params, request }) => {
    await delay(90);
    const a = store.agents.find((x) => x.id === params.id);
    if (!a) return new HttpResponse(null, { status: 404 });
    const { skills } = (await request.json()) as { skills: string[] };
    a.skills = skills; a.updated_at = nowIso();
    return HttpResponse.json(clone(a.skills));
  }),
  http.get(`${B}/agents/:id`, async ({ params }) => {
    await delay(90);
    const row = store.agents.find((a) => a.id === params.id);
    return row ? HttpResponse.json(clone(row)) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${B}/agents`, async ({ request }) => {
    await delay(130);
    const req = (await request.json()) as UpsertAgentReq;
    const row = {
      id: nextId("a"), workspace_id: "ws-loop-demo", name: req.name,
      description: req.description ?? "", instructions: req.instructions ?? "",
      status: req.status ?? "idle", runtime_id: req.runtime_id ?? "rt-001",
      runtime_name: "kaka-mbp", model: req.model ?? "claude-opus-4",
      thinking_level: req.thinking_level ?? "none", visibility: req.visibility ?? "workspace",
      max_concurrent_tasks: req.max_concurrent_tasks ?? 1, custom_args: req.custom_args ?? [],
      owner_name: "lvsijia", skills: [], runs_30d: 0,
      created_at: nowIso(), updated_at: nowIso(),
    };
    store.agents.push(row);
    return HttpResponse.json(clone(row), { status: 201 });
  }),
  http.put(`${B}/agents/:id`, async ({ params, request }) => {
    await delay(100);
    const row = store.agents.find((a) => a.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const req = (await request.json()) as UpsertAgentReq;
    row.name = req.name;
    if (req.description !== undefined) row.description = req.description;
    if (req.instructions !== undefined) row.instructions = req.instructions;
    if (req.status !== undefined) row.status = req.status;
    if (req.model !== undefined) row.model = req.model;
    if (req.thinking_level !== undefined) row.thinking_level = req.thinking_level;
    if (req.visibility !== undefined) row.visibility = req.visibility;
    if (req.max_concurrent_tasks !== undefined) row.max_concurrent_tasks = req.max_concurrent_tasks;
    if (req.custom_args !== undefined) row.custom_args = req.custom_args;
    row.updated_at = nowIso();
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/agents/:id`, async ({ params }) => {
    await delay(90);
    store.agents = store.agents.filter((a) => a.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------- squads ---------- */
  http.get(`${B}/squads`, async ({ request }) => {
    await delay(130);
    const url = new URL(request.url);
    let rows = filterByWs(store.squads, url);
    rows = byKeyword(rows, url, (s) => [s.name, s.description]);
    return HttpResponse.json(clone(rows));
  }),
  http.get(`${B}/squads/:id`, async ({ params }) => {
    await delay(90);
    const row = store.squads.find((s) => s.id === params.id);
    return row ? HttpResponse.json(clone(row)) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${B}/squads`, async ({ request }) => {
    await delay(130);
    const req = (await request.json()) as UpsertSquadReq;
    const leaderId = req.leader_id ?? "u-1";
    const row = {
      id: nextId("s"), workspace_id: "ws-loop-demo", name: req.name,
      description: req.description ?? "", instructions: req.instructions ?? "",
      leader_id: leaderId, leader_name: candName(leaderId) ?? leaderId,
      creator_name: "lvsijia",
      members: [{
        member_type: (candType(leaderId) ?? "member") as AssigneeType,
        member_id: leaderId, member_name: candName(leaderId) ?? leaderId, role: "leader",
      }],
      created_at: nowIso(), updated_at: nowIso(),
    };
    store.squads.push(row);
    return HttpResponse.json(clone(row), { status: 201 });
  }),
  http.put(`${B}/squads/:id`, async ({ params, request }) => {
    await delay(100);
    const row = store.squads.find((s) => s.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const req = (await request.json()) as UpsertSquadReq;
    row.name = req.name;
    if (req.description !== undefined) row.description = req.description;
    if (req.instructions !== undefined) row.instructions = req.instructions;
    if (req.leader_id !== undefined) { row.leader_id = req.leader_id; row.leader_name = candName(req.leader_id) ?? req.leader_id; }
    row.updated_at = nowIso();
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/squads/:id`, async ({ params }) => {
    await delay(90);
    store.squads = store.squads.filter((s) => s.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${B}/squads/:id/members`, async ({ params }) => {
    await delay(80);
    const row = store.squads.find((s) => s.id === params.id);
    return HttpResponse.json(clone(row?.members ?? []));
  }),
  http.post(`${B}/squads/:id/members`, async ({ params, request }) => {
    await delay(100);
    const row = store.squads.find((s) => s.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const { member_id, role } = (await request.json()) as { member_id: string; role?: string };
    const cand = CANDIDATES.find((c) => c.id === member_id);
    if (cand && !row.members.some((m) => m.member_id === member_id)) {
      row.members.push({ member_type: cand.type, member_id: cand.id, member_name: cand.name, role: role ?? "member" });
      row.updated_at = nowIso();
    }
    return HttpResponse.json(clone(row));
  }),
  http.delete(`${B}/squads/:id/members`, async ({ params, request }) => {
    await delay(90);
    const row = store.squads.find((s) => s.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });
    const { member_id } = (await request.json()) as { member_id: string };
    row.members = row.members.filter((m) => m.member_id !== member_id);
    row.updated_at = nowIso();
    return HttpResponse.json(clone(row));
  }),
];

function applyIssueUpdate(row: Issue, req: UpdateIssueReq) {
  if (req.title !== undefined) row.title = req.title;
  if (req.description !== undefined) row.description = req.description;
  if (req.status !== undefined) row.status = req.status;
  if (req.priority !== undefined) row.priority = req.priority;
  if (req.position !== undefined) row.position = req.position;
  if (req.assignee_id !== undefined) {
    row.assignee_id = req.assignee_id;
    row.assignee_type = candType(req.assignee_id) ?? req.assignee_type ?? null;
    row.assignee_name = candName(req.assignee_id);
  }
  if (req.project_id !== undefined) {
    row.project_id = req.project_id;
    row.project_name = req.project_id
      ? store.projects.find((p) => p.id === req.project_id)?.title ?? null
      : null;
  }
  row.updated_at = nowIso();
}

/* ---------- worker 启动 ---------- */

let _worker: SetupWorker | null = null;

/**
 * 启动 Loop Mock（MSW service worker）。
 * @param extraHandlers 其他包（如 @octo/runtime）的 handlers。
 */
export async function startLoopMock(
  extraHandlers: RequestHandler[] = [],
): Promise<void> {
  if (_worker) return;
  _worker = setupWorker(...loopHandlers, ...extraHandlers);
  await _worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
}
