import type { Page } from "@playwright/test";

/** Published Skill owned by the signed-in user, used to open the real upgrade flow. */
export async function registerSkillUpgradeLeaveConfirm(page: Page): Promise<void> {
  function install(): boolean {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: (info: { request: { url: string } }) => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __skillUpgradeLeaveConfirmInstalled?: boolean;
      __skillUpgradeLeaveConfirmTimer?: number;
    };
    if (!win.__msw) {
      if (!win.__skillUpgradeLeaveConfirmTimer) {
        win.__skillUpgradeLeaveConfirmTimer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__skillUpgradeLeaveConfirmTimer);
        }, 10);
      }
      return false;
    }
    if (win.__skillUpgradeLeaveConfirmInstalled) return true;

    const { worker, http, HttpResponse } = win.__msw;
    const skill = {
      plugin_id: "upgrade-leave-demo",
      plugin_name: "升级确认示例",
      plugin_type: "skill",
      category_id: "e2e-skill-category",
      tags: ["e2e"],
      publisher: "E2E Tester",
      owner_id: "e2e-user-1",
      space_id: "e2e-space-001",
      visibility: "space",
      creator_name: "E2E Tester",
      created_by_type: "human",
      icon_url: "",
      view_count: 3,
      download_count: 1,
      install_count: 0,
      current_version: "1.0.0",
      listing_state: "published",
      display_status: "published",
      manifest_json: {
        name: "upgrade-leave-demo",
        description: "用于验证升级离开确认交互。",
        labels: ["e2e"],
      },
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    };

    worker.use(
      http.get("*/market/api/v1/plugins", () =>
        HttpResponse.json({
          data: [skill],
          pagination: { total: 1, page: 1, page_size: 20 },
        })
      ),
      http.get("*/market/api/v1/plugin_categories", () =>
        HttpResponse.json({
          data: [
            {
              category_id: "e2e-skill-category",
              name: "测试分类",
              sort_order: 0,
              plugin_count: 1,
            },
          ],
        })
      ),
      http.get("*/market/api/v1/plugin_tags", () =>
        HttpResponse.json({ data: [{ name: "e2e", count: 1 }] })
      )
    );
    win.__skillUpgradeLeaveConfirmInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
