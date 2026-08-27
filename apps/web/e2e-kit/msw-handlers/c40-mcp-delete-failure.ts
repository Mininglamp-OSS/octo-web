import type { Page } from "@playwright/test";

export async function registerC40McpDeleteFailure(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: () => unknown) => unknown;
        delete: (path: string, resolver: () => unknown) => unknown;
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
      mcp_id: "delete-failure-mcp",
      name: "Delete Failure MCP",
      slogan: "A connector that cannot be deleted in this scenario.",
      category: "dev",
      icon: "🧪",
      tags: ["e2e"],
      tool_count: 1,
      visibility: "public",
      source: "mine",
      creator_name: "E2E Tester",
      created_by_type: "human",
      transport: "streamable-http",
      match_reasons: [],
      updated_at: "2026-08-26T00:00:00Z",
    };
    win.__msw.worker.use(
      win.__msw.http.get("*/market/api/v1/mcps", () =>
        win.__msw!.HttpResponse.json({ data: [], pagination: { total: 0, page: 1, page_size: 20 } }),
      ),
      win.__msw.http.get("*/market/api/v1/mcps/mine", () =>
        win.__msw!.HttpResponse.json({
          data: [item],
          pagination: { total: 1, page: 1, page_size: 20 },
        }),
      ),
      win.__msw.http.get("*/market/api/v1/mcp_categories", () =>
        win.__msw!.HttpResponse.json({ data: [{ key: "dev", count: 1 }] }),
      ),
      win.__msw.http.delete("*/market/api/v1/mcps/delete-failure-mcp", () =>
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
