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
import { http, HttpResponse } from "msw";

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

export const loopEmptyHandlers = [
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
    if (s === "one-ws" || s === "one-issue") return HttpResponse.json([WS_A]);
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

  // 兜底: 未被具体路由匹配到的 fleet 端点
  http.get("*/fleet/api/v1/projects", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/labels", () => HttpResponse.json([])),
  http.get("*/fleet/api/v1/issues/candidates", () => HttpResponse.json([])),
  http.all("*/fleet/api/v1/*", () => HttpResponse.json([])),
  http.all("*/fleet/api/v1/**", () => HttpResponse.json([])),
];
