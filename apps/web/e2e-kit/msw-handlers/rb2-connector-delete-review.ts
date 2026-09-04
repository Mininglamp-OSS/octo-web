import type { Page } from "@playwright/test";

// 连接器删除后的审核失效 (RB2).
//
// A connector with an OPEN review request is deleted. The marketplace backend
// cancels that request in the same transaction as the delete
// (`cancelPendingReviewFor` / `reasonCanceledOnDelete`, pinned by
// octo-marketplace's TestDeleteCancelsThePendingReviewRequest), so the Space's
// pending count genuinely drops the moment the delete returns — which is
// exactly why a client that does not re-read shows a badge for a plugin that no
// longer exists.
//
// Deliberately STATEFUL, for the same reason RB1's handler is: `POST
// /plugins/delete` removes the connector from BOTH the 我的发布 list and the
// pending queue. A stub that always answered total=1 would pass whether or not
// the sidebar badge re-read at all, and a stub that always answered total=0
// would pass before the fix.
export async function registerRb2ConnectorDeleteReview(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: { request: { url: string } }) => unknown) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __rb2Installed?: boolean;
      __rb2Timer?: number;
    };
    if (!win.__msw) {
      if (!win.__rb2Timer) {
        win.__rb2Timer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__rb2Timer);
        }, 10);
      }
      return false;
    }
    if (win.__rb2Installed) return true;

    const PLUGIN_ID = "rb2-connector";
    const PLUGIN_NAME = "待审连接器";
    // The one piece of mutable state: flipped by the delete, read by BOTH the
    // list and the review queue.
    let deleted = false;

    const connector = {
      plugin_id: PLUGIN_ID,
      plugin_name: PLUGIN_NAME,
      plugin_type: "connector",
      category_id: "dev-cat",
      tags: ["e2e"],
      publisher: "E2E Tester",
      owner_id: "e2e-space-001",
      visibility: "space",
      creator_name: "E2E Tester",
      created_by_type: "human",
      icon_url: "🔌",
      tool_count: 1,
      view_count: 0,
      install_count: 0,
      download_count: 0,
      current_version: "1.0.0",
      listing_state: "draft",
      manifest_json: {
        name: PLUGIN_ID,
        description: "A connector with an open review request.",
        labels: ["e2e"],
      },
      created_at: "2026-08-26T00:00:00Z",
      updated_at: "2026-08-26T00:00:00Z",
    };

    const reviewRequest = {
      review_id: "rb2-review-1",
      plugin_id: PLUGIN_ID,
      plugin_name: PLUGIN_NAME,
      plugin_type: "connector",
      space_id: "e2e-space-001",
      target_scope: "space",
      status: "pending",
      kind: "first",
      version: "1.0.0",
      changelog: "首次提交组织审核",
      applicant_id: "e2e-user-1",
      applicant_name: "E2E Tester",
      submitted_at: "2026-08-31T10:00:00.000Z",
      plugin_listing_state: "draft",
    };

    function page(items: unknown[], url: URL) {
      const p = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
      const size = Number.parseInt(url.searchParams.get("page_size") ?? "20", 10) || 20;
      const start = (p - 1) * size;
      return {
        data: items.slice(start, start + size),
        pagination: { total: items.length, page: p, page_size: size },
      };
    }

    win.__msw.worker.use(
      win.__msw.http.get("*/market/api/v1/plugins/review_requests", ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const open = deleted || (status !== null && status !== "pending") ? [] : [reviewRequest];
        return win.__msw!.HttpResponse.json(page(open, url));
      }),
      win.__msw.http.post("*/market/api/v1/plugins/delete", () => {
        deleted = true;
        return win.__msw!.HttpResponse.json({ data: {} });
      }),
      win.__msw.http.get("*/market/api/v1/plugins", ({ request }) => {
        const url = new URL(request.url);
        const mine =
          url.searchParams.get("mode") === "mine" &&
          url.searchParams.get("plugin_type") === "connector";
        const items = mine && !deleted ? [connector] : [];
        return win.__msw!.HttpResponse.json(page(items, url));
      }),
      win.__msw.http.get("*/market/api/v1/plugin_categories", () =>
        win.__msw!.HttpResponse.json({
          data: [{ category_id: "dev-cat", name: "dev", sort_order: 0, plugin_count: 1 }],
        }),
      ),
      win.__msw.http.post("*/market/api/v1/metrics/track", () =>
        win.__msw!.HttpResponse.json({ data: {} }),
      ),
    );
    win.__rb2Installed = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
