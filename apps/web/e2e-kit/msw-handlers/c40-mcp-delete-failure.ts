import type { Page } from "@playwright/test";

// Unified plugin surface: list/mine both go through GET /plugins (mode=mine for
// the 我的 view), categories through GET /plugin_categories, and delete through
// POST /plugins/delete. The delete resolves 500 so the confirm modal keeps the
// row and shows 删除失败. The item is plugin-wire shaped (icon "🧪" + creator
// "E2E Tester") so the card name matches /^🧪 Delete Failure MCP E2E/.
export async function registerC40McpDeleteFailure(page: Page): Promise<void> {
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
      __c40Installed?: boolean;
      __c40Timer?: number;
    };
    if (!win.__msw) {
      if (!win.__c40Timer) {
        win.__c40Timer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__c40Timer);
        }, 10);
      }
      return false;
    }
    if (win.__c40Installed) return true;
    const item = {
      plugin_id: "delete-failure-mcp",
      plugin_name: "Delete Failure MCP",
      plugin_type: "connector",
      category_id: "dev-cat",
      tags: ["e2e"],
      publisher: "E2E Tester",
      owner_id: "space-e2e",
      visibility: "public",
      creator_name: "E2E Tester",
      created_by_type: "human",
      icon_url: "🧪",
      tool_count: 1,
      view_count: 0,
      install_count: 0,
      download_count: 0,
      current_version: "1.0.0",
      manifest_json: {
        name: "delete-failure-mcp",
        description: "A connector that cannot be deleted in this scenario.",
        labels: ["e2e"],
      },
      created_at: "2026-08-26T00:00:00Z",
      updated_at: "2026-08-26T00:00:00Z",
    };
    win.__msw.worker.use(
      // Both 全部 and 我的 hit GET /plugins; the 我的 view sends mode=mine.
      win.__msw.http.get("*/market/api/v1/plugins", ({ request }) => {
        const mode = new URL(request.url).searchParams.get("mode");
        const data = mode === "mine" ? [item] : [];
        return win.__msw!.HttpResponse.json({
          data,
          pagination: { total: data.length, page: 1, page_size: 20 },
        });
      }),
      win.__msw.http.get("*/market/api/v1/plugin_categories", () =>
        win.__msw!.HttpResponse.json({
          data: [{ category_id: "dev-cat", name: "dev", sort_order: 0, plugin_count: 1 }],
        }),
      ),
      win.__msw.http.post("*/market/api/v1/plugins/delete", () =>
        win.__msw!.HttpResponse.json(
          { error: { message: "删除失败" } },
          { status: 500 },
        ),
      ),
    );
    win.__c40Installed = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
