import type { Page } from "@playwright/test";

export async function registerC38McpListRetry(page: Page): Promise<void> {
  function install() {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown, init?: unknown) => unknown } };
    const win = globalThis as unknown as { __msw?: Msw; __c38Installed?: boolean; __c38Timer?: number; __c38RetryRequested?: boolean };
    if (!win.__msw) {
      if (!win.__c38Timer) win.__c38Timer = window.setInterval(() => { if (install()) window.clearInterval(win.__c38Timer); }, 10);
      return false;
    }
    if (win.__c38Installed) return true;
    const list = () => {
      if (!win.__c38RetryRequested) {
        return win.__msw!.HttpResponse.json({ message: "temporary failure" }, { status: 500 });
      }
      return win.__msw!.HttpResponse.json({ data: [{ mcp_id: "retryable-search", name: "Retryable Search MCP", slogan: "Retryable search", category: "search", icon: "🔎", tags: ["search"], tool_count: 1, visibility: "public", source: "space", creator_name: "Alice", created_by_type: "human", match_reasons: [], updated_at: "2026-08-26T00:00:00Z" }], pagination: { total: 1, page: 1, page_size: 20 } });
    };
    const categories = () => win.__msw!.HttpResponse.json({ data: [{ key: "search", count: 1 }] });
    win.__msw.worker.use(
      win.__msw.http.get("*/market/api/v1/mcps", list),
      win.__msw.http.get("*/market/api/v1/mcp_categories", categories),
    );
    win.__c38Installed = true;
    return true;
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
