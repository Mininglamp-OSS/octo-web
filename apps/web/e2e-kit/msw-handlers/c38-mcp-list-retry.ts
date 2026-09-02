import type { Page } from "@playwright/test";

// Unified plugin surface: the MCP market fetches GET /plugins (plugin_type=
// connector) + GET /plugin_categories, not the legacy /mcps + /mcp_categories.
// The list 500s until the spec sets __c38RetryRequested, then returns one
// plugin-wire row that mapListItem projects to the McpListItem the spec asserts.
export async function registerC38McpListRetry(page: Page): Promise<void> {
  function install() {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown, init?: unknown) => unknown } };
    const win = globalThis as unknown as { __msw?: Msw; __c38Installed?: boolean; __c38Timer?: number; __c38RetryRequested?: boolean };
    if (!win.__msw) {
      if (!win.__c38Timer) win.__c38Timer = window.setInterval(() => { if (install()) window.clearInterval(win.__c38Timer); }, 10);
      return false;
    }
    if (win.__c38Installed) return true;
    const plugin = {
      plugin_id: "retryable-search",
      plugin_name: "Retryable Search MCP",
      plugin_type: "connector",
      category_id: "search-cat",
      tags: ["search"],
      publisher: "Octo Community",
      owner_id: "space-e2e",
      visibility: "public",
      creator_name: "Alice",
      created_by_type: "human",
      icon_url: "",
      tool_count: 1,
      view_count: 3,
      install_count: 1,
      download_count: 0,
      current_version: "1.0.0",
      manifest_json: { name: "retryable-search", description: "Retryable search", labels: ["search"] },
      created_at: "2026-08-26T00:00:00Z",
      updated_at: "2026-08-26T00:00:00Z",
    };
    const list = () => {
      if (!win.__c38RetryRequested) {
        return win.__msw!.HttpResponse.json({ message: "temporary failure" }, { status: 500 });
      }
      return win.__msw!.HttpResponse.json({ data: [plugin], pagination: { total: 1, page: 1, page_size: 20 } });
    };
    const categories = () => win.__msw!.HttpResponse.json({ data: [{ category_id: "search-cat", name: "search", sort_order: 0, plugin_count: 1 }] });
    win.__msw.worker.use(
      win.__msw.http.get("*/market/api/v1/plugins", list),
      win.__msw.http.get("*/market/api/v1/plugin_categories", categories),
    );
    win.__c38Installed = true;
    return true;
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
