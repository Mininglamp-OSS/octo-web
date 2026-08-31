import type { Page } from "@playwright/test";

export async function registerSP4SpaceInviteFull(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __sp4MswInstalled?: boolean;
      __sp4MswTimer?: number;
    };
    if (!win.__msw) {
      if (!win.__sp4MswTimer) {
        win.__sp4MswTimer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__sp4MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__sp4MswInstalled) return true;
    win.__msw.worker.use(
      win.__msw.http.get("*/space/invite/SP4-FULL", () =>
        win.__msw!.HttpResponse.json({
          invite_code: "SP4-FULL",
          space_id: "sp4-full-space",
          space_name: "SP4 满员组织",
          member_count: 100,
          max_users: 100,
        })
      ),
      win.__msw.http.get("*/api/v1/space/invite/SP4-FULL", () =>
        win.__msw!.HttpResponse.json({
          invite_code: "SP4-FULL",
          space_id: "sp4-full-space",
          space_name: "SP4 满员组织",
          member_count: 100,
          max_users: 100,
        })
      ),
    );
    win.__sp4MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
