import type { Page } from "@playwright/test";

export async function registerSP5SpaceInviteApproval(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: () => unknown) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __sp5MswInstalled?: boolean;
      __sp5MswTimer?: number;
    };
    if (!win.__msw) {
      if (!win.__sp5MswTimer) {
        win.__sp5MswTimer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__sp5MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__sp5MswInstalled) return true;
    const space = {
      invite_code: "SP5-APPROVAL",
      space_id: "sp5-approval-space",
      space_name: "SP5 审批组织",
      member_count: 1,
      max_users: 100,
    };
    win.__msw.worker.use(
      win.__msw.http.get("*/space/invite/SP5-APPROVAL", () => win.__msw!.HttpResponse.json(space)),
      win.__msw.http.get("*/api/v1/space/invite/SP5-APPROVAL", () => win.__msw!.HttpResponse.json(space)),
      win.__msw.http.post("*/space/join", () =>
        win.__msw!.HttpResponse.json({ space_id: space.space_id, status: "NEED_APPROVAL" })
      )
    );
    win.__sp5MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
