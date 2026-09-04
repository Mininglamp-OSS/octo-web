import type { Page } from "@playwright/test";

// 切换组织后的审核徽标 (RB3).
//
// Two Spaces, the user is owner (role 2) in both, and each has a DIFFERENT
// non-zero number of pending review requests. Every review read carries the
// active Space in the `X-Space-Id` header (see @dmwork/skillmarket
// api/skillApiReal.ts `getAuthHeaders`), so this handler answers the SAME
// endpoint with a different count per Space.
//
// Both counts are non-zero on purpose. A 1 → 0 transition is ambiguous: the
// badge hides itself whenever the probe is disabled or its state is cleared, so
// "the badge disappeared" is evidence of a re-read only if you also know nothing
// cleared it. 1 → 3 can be produced by exactly one thing — a fresh read carrying
// the new Space's header.
export async function registerRb3SpaceSwitchReviewBadge(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (
          path: string,
          resolver: (info: { request: { url: string; headers: Headers } }) => unknown,
        ) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __rb3Installed?: boolean;
      __rb3Timer?: number;
    };
    if (!win.__msw) {
      if (!win.__rb3Timer) {
        win.__rb3Timer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__rb3Timer);
        }, 10);
      }
      return false;
    }
    if (win.__rb3Installed) return true;

    const SPACE_A = "e2e-space-001";
    const SPACE_B = "e2e-space-002";

    const space = (id: string, name: string) => ({
      space_id: id,
      name,
      description: "",
      logo: "",
      create_at: "2026-07-20T10:00:00Z",
      update_at: "2026-07-20T10:00:00Z",
      space_no: id,
      owner: "e2e-user-1",
      status: 1,
      role: 2,
      member_count: 1,
      max_users: 0,
    });

    const pendingRequest = (id: string, spaceId: string, name: string) => ({
      review_id: id,
      plugin_id: `${id}-plugin`,
      plugin_name: name,
      plugin_type: "skill",
      space_id: spaceId,
      target_scope: "space",
      status: "pending",
      kind: "first",
      version: "1.0.0",
      changelog: "首次提交组织审核",
      applicant_id: "e2e-user-2",
      applicant_name: "Jian",
      submitted_at: "2026-08-31T10:00:00.000Z",
      plugin_listing_state: "draft",
    });

    // 甲组织: 1 pending. 乙组织: 3.
    const pendingBySpace: Record<string, unknown[]> = {
      [SPACE_A]: [pendingRequest("rb3-a-1", SPACE_A, "甲组织的待审技能")],
      [SPACE_B]: [
        pendingRequest("rb3-b-1", SPACE_B, "乙组织的待审技能一"),
        pendingRequest("rb3-b-2", SPACE_B, "乙组织的待审技能二"),
        pendingRequest("rb3-b-3", SPACE_B, "乙组织的待审技能三"),
      ],
    };

    function pageOf(items: unknown[], url: URL) {
      const p = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
      const size = Number.parseInt(url.searchParams.get("page_size") ?? "20", 10) || 20;
      const start = (p - 1) * size;
      return {
        data: items.slice(start, start + size),
        pagination: { total: items.length, page: p, page_size: size },
      };
    }

    win.__msw.worker.use(
      win.__msw.http.get("*/space/my", () =>
        win.__msw!.HttpResponse.json([space(SPACE_A, "甲组织"), space(SPACE_B, "乙组织")]),
      ),
      win.__msw.http.get("*/market/api/v1/plugins/review_requests", ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const activeSpace = request.headers.get("x-space-id") ?? "";
        const open =
          status === null || status === "pending" ? pendingBySpace[activeSpace] ?? [] : [];
        return win.__msw!.HttpResponse.json(pageOf(open, url));
      }),
      win.__msw.http.get("*/market/api/v1/plugins", ({ request }) =>
        win.__msw!.HttpResponse.json(pageOf([], new URL(request.url))),
      ),
      win.__msw.http.get("*/market/api/v1/plugin_categories", () =>
        win.__msw!.HttpResponse.json({ data: [] }),
      ),
      win.__msw.http.post("*/market/api/v1/metrics/track", () =>
        win.__msw!.HttpResponse.json({ data: {} }),
      ),
    );
    win.__rb3Installed = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
