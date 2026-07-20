/**
 * loop MSW baseline handlers.
 *
 * 场景通过 sessionStorage.__e2e_scenario 分发, 让 handler 在 SW nav 后仍能拿到状态.
 * spec 在 goto 前 `await page.addInitScript(...)` 或 evaluate 塞 scenario.
 *
 * 已实现的 scenario:
 *   - "empty" (默认): 无 workspace, 空态引导
 *   - "one-ws": 一个 workspace (C3 用)
 *   - "create-ws": POST 前空, POST 后有 (C2 用)
 *   - "two-ws": 两个 workspace (C6 切换用)
 *   - "one-issue": 一个 workspace + 一个 issue (C5 用)
 */
import { http, HttpResponse, passthrough } from "msw";

// scenario 数据源 (spec 可通过 sessionStorage.setItem('__e2e_scenario_data', JSON) 覆盖)
type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string;
  issue_prefix: string;
  avatar_url: null;
  created_at: string;
  updated_at: string;
};

const WS_A: Workspace = {
  id: "ws-a",
  name: "Workspace A",
  slug: "workspace-a",
  description: "",
  issue_prefix: "LOOP",
  avatar_url: null,
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
};
const WS_B: Workspace = {
  ...WS_A,
  id: "ws-b",
  name: "Workspace B",
  slug: "workspace-b",
  issue_prefix: "LOOPB",
};
const WS_CREATED: Workspace = {
  ...WS_A,
  id: "ws-e2e-c2",
  name: "E2E Workspace C2",
  slug: "e2e-workspace-c2",
  issue_prefix: "LOOP",
};

function scenario(): string {
  try {
    return sessionStorage.getItem("__e2e_scenario") || "empty";
  } catch {
    return "empty";
  }
}

// 让"迁移进来但不走 loop mock 层"的 spec (bind / standalone-doc) 显式 opt-out.
// 这些 spec 用 page.route() 自己精确 mock, 不需要 MSW handler 打搅.
// scenario === "no-mock" 时所有 handler 直接 passthrough, 让 spec 的
// page.route (在浏览器 network layer, MSW SW 之下) 或者 spec 自己控的 storage 生效.
function bypassAll(): boolean {
  return scenario() === "no-mock";
}

function markPostCreated(): void {
  try {
    sessionStorage.setItem("__e2e_c2_created", "1");
  } catch {
    /* noop */
  }
}
function wasPostCreated(): boolean {
  try {
    return sessionStorage.getItem("__e2e_c2_created") === "1";
  } catch {
    return false;
  }
}

const ISSUE_A = {
  id: "issue-a",
  workspace_id: "ws-a",
  number: 1,
  identifier: "LOOP-1",
  title: "First issue",
  description: "",
  status: "todo",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "u-1",
  project_id: null,
  position: 0,
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
  creator_name: "E2E Tester",
};

// members baseline (scenario ws-with-members / member-remove)
const MEMBER_ADMIN = {
  id: "m-admin",
  workspace_id: "ws-a",
  user_id: "u-admin",
  role: "admin",
  name: "Admin User",
  email: "admin@example.com",
  octo_uid: "uid-admin",
  avatar_url: null,
};
const MEMBER_ORD = {
  id: "m-ord",
  workspace_id: "ws-a",
  user_id: "u-ord",
  role: "member",
  name: "Ordinary Member",
  email: "ord@example.com",
  octo_uid: "uid-ord",
  avatar_url: null,
};

// space 全量成员 (SpaceService.getAllMembers), C23 添加成员候选来源
const SPACE_HUMANS = [
  MEMBER_ADMIN,
  MEMBER_ORD,
  { uid: "uid-newbie", name: "Newbie User", short_no: "20000", robot: 0, sex: 1, role: 0 },
].map((m: Record<string, unknown>) => ({
  uid: m.uid ?? (m as { octo_uid?: string }).octo_uid ?? "uid-x",
  name: m.name ?? "User",
  short_no: (m as { short_no?: string }).short_no ?? "00000",
  robot: 0,
  sex: 1,
  role: 0,
  status: 1,
  ...m,
}));

// sessionStorage 里追踪 "已 remove 的 member id" (C24 用)
function isMemberRemoved(memberId: string): boolean {
  try {
    const removed = JSON.parse(sessionStorage.getItem("__e2e_removed_members") || "[]") as string[];
    return removed.includes(memberId);
  } catch {
    return false;
  }
}
function markMemberRemoved(memberId: string): void {
  try {
    const removed = JSON.parse(sessionStorage.getItem("__e2e_removed_members") || "[]") as string[];
    removed.push(memberId);
    sessionStorage.setItem("__e2e_removed_members", JSON.stringify(removed));
  } catch {
    /* noop */
  }
}
// sessionStorage 存"新加成员" (C23 用)
function getAddedMembers(): typeof MEMBER_ADMIN[] {
  try {
    return JSON.parse(sessionStorage.getItem("__e2e_added_members") || "[]");
  } catch {
    return [];
  }
}
function addMember(m: typeof MEMBER_ADMIN): void {
  try {
    const list = getAddedMembers();
    list.push(m);
    sessionStorage.setItem("__e2e_added_members", JSON.stringify(list));
  } catch {
    /* noop */
  }
}

export const loopEmptyHandlers = [
  // scenario="no-mock" opt-out: 迁移进来的老 spec (bind / standalone-doc) 用
  // page.route 自己 mock, 需要 kit 层不打扰. 全域最优先 passthrough:
  //  - 匹配所有请求 (http.all with wildcard `*`)
  //  - passthrough() 让请求继续走 network → page.route 能在 CDP 层再拦
  //  - 若不是 no-mock scenario, 返 undefined 让 MSW 走下一个 handler
  http.all("*", ({ request }) => {
    if (!bypassAll()) return undefined;
    // 忽略同源静态资源 (vite dev bundle 需要真正走 network, 别 passthrough 打扰)
    // 只对 /api /v1 /fleet 这类 API 做 passthrough
    const u = new URL(request.url);
    if (/^\/(api|v1|fleet)(\/|$)/.test(u.pathname)) return passthrough();
    return undefined;
  }),

  http.get("*/common/appconfig", () =>
    HttpResponse.json({
      dmloop_on: "1",
      docs_on: "0",
      dmpersonal_on: "0",
      thread_on: false,
      oidc_providers: [],
    })
  ),

  http.get("*/fleet/api/v1/workspaces", () => {
    const s = scenario();
    if (
      s === "one-ws" ||
      s === "one-issue" ||
      s === "ws-with-members" ||
      s === "member-remove"
    )
      return HttpResponse.json([WS_A]);
    if (s === "two-ws") return HttpResponse.json([WS_A, WS_B]);
    if (s === "create-ws") {
      return HttpResponse.json(wasPostCreated() ? [WS_CREATED] : []);
    }
    return HttpResponse.json([]);
  }),

  http.post("*/fleet/api/v1/workspaces", async ({ request }) => {
    if (scenario() === "create-ws") {
      markPostCreated();
      return HttpResponse.json(WS_CREATED);
    }
    // 默认 echo 用户传参 (以后可以扩)
    const body = (await request.json()) as { name: string; slug: string };
    return HttpResponse.json({
      ...WS_CREATED,
      name: body.name,
      slug: body.slug || WS_CREATED.slug,
    });
  }),

  http.get("*/fleet/api/v1/issues", () => {
    const s = scenario();
    if (s === "one-issue") return HttpResponse.json({ issues: [ISSUE_A], total: 1 });
    return HttpResponse.json({ issues: [], total: 0 });
  }),

  http.put("*/fleet/api/v1/issues/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...ISSUE_A, id: params.id, ...body });
  }),

  // GET /issues/:id (issue 详情) — 必须精确, 否则会被下面 `*/fleet/api/v1/*` 兜底 [] 打坏
  http.get("*/fleet/api/v1/issues/:id", ({ params }) =>
    HttpResponse.json({ ...ISSUE_A, id: params.id as string })
  ),

  // 子 issues / 评论 / 时间线 / 订阅者 / runs — 详情页并发拉的一堆, 全返空避免报错
  http.get("*/fleet/api/v1/issues/:id/children", () =>
    HttpResponse.json({ issues: [] })
  ),
  http.get("*/fleet/api/v1/issues/:id/comments", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/issues/:id/subscribers", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/issues/:id/timeline", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/runs", () => HttpResponse.json([])),

  http.post("*/fleet/api/v1/issues", async ({ request }) => {
    const body = (await request.json()) as { title: string };
    return HttpResponse.json({
      ...ISSUE_A,
      id: "issue-created",
      identifier: "LOOP-99",
      title: body.title,
    });
  }),

  // ── workspace PATCH (C7) ──────────────────────────────────────────────
  http.patch("*/fleet/api/v1/workspaces/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...WS_A, id: params.id, ...body });
  }),

  // ── workspace members (C23/C24) ───────────────────────────────────────
  http.get("*/fleet/api/v1/workspaces/:id/members", () => {
    const s = scenario();
    if (s === "ws-with-members" || s === "member-remove") {
      const base = [MEMBER_ADMIN, MEMBER_ORD].filter((m) => !isMemberRemoved(m.id));
      return HttpResponse.json([...base, ...getAddedMembers()]);
    }
    return HttpResponse.json([]);
  }),
  http.get("*/fleet/api/v1/workspaces/:id/invitations", () => HttpResponse.json([])),
  http.post("*/fleet/api/v1/workspaces/:id/octo-members", async ({ request, params }) => {
    const body = (await request.json()) as { octo_uid: string; role?: string };
    const added = {
      id: `m-added-${body.octo_uid}`,
      workspace_id: params.id as string,
      user_id: `u-${body.octo_uid}`,
      role: body.role ?? "member",
      name: SPACE_HUMANS.find((h) => h.uid === body.octo_uid)?.name ?? `User ${body.octo_uid}`,
      email: `${body.octo_uid}@e2e.local`,
      octo_uid: body.octo_uid,
      avatar_url: null,
    };
    addMember(added);
    return HttpResponse.json(added);
  }),
  http.delete("*/fleet/api/v1/workspaces/:id/members/:memberId", ({ params }) => {
    markMemberRemoved(params.memberId as string);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── SpaceService.getAllMembers (C23 候选下拉) ────────────────────────
  http.get("*/api/v1/space/:spaceId/members", () =>
    HttpResponse.json(SPACE_HUMANS)
  ),

  // 兜底: 未被具体路由匹配到的 fleet 端点
  http.get("*/fleet/api/v1/projects", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/labels", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/issues/candidates", () => HttpResponse.json([])),
  http.all("*/fleet/api/v1/*", () => HttpResponse.json([])),
  http.all("*/fleet/api/v1/**", () => HttpResponse.json([])),
];
