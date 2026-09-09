import type { Page } from "@playwright/test";

/** Local-only rows for the real My publications pages; no DOM sizing overrides. */
export async function registerMyPublicationsScroll(page: Page): Promise<void> {
  function install(): boolean {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: (info: { request: { url: string } }) => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __mineScrollInstalled?: boolean;
      __mineScrollTimer?: number;
    };
    if (!win.__msw) {
      if (!win.__mineScrollTimer) {
        win.__mineScrollTimer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__mineScrollTimer);
        }, 10);
      }
      return false;
    }
    if (win.__mineScrollInstalled) return true;
    const { worker, http, HttpResponse } = win.__msw;
    worker.use(
      http.get("*/market/api/v1/plugins", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const type = params.get("plugin_type") ?? "skill";
        const data = Array.from({ length: 16 }, (_, i) => ({
          plugin_id: `${type}-scroll-${i + 1}`,
          plugin_name: `Scroll asset ${i + 1}`,
          plugin_type: type,
          category_id: "scroll-category",
          visibility: "private",
          created_by_type: "human",
          creator_name: "E2E Tester",
          owner_id: "e2e-user-1",
          publisher: "E2E Tester",
          current_version: "1.0.0",
          tags: ["scroll"],
          manifest_json: {
            name: `Scroll asset ${i + 1}`,
            description: "Personal publication used to verify scrolling and access to actions.",
          },
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        }));
        return HttpResponse.json({ data, pagination: { total: data.length, page: 1, page_size: 100 } });
      }),
      http.get("*/market/api/v1/plugin_categories", () => HttpResponse.json({
        data: [{ category_id: "scroll-category", name: "Scroll", sort_order: 0, plugin_count: 16 }],
      })),
      http.get("*/market/api/v1/plugin_tags", () => HttpResponse.json({
        data: [{ name: "scroll", count: 16 }],
      })),
    );
    win.__mineScrollInstalled = true;
    return true;
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
