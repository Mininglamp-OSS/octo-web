import type { Page } from "@playwright/test";

export async function registerSP3SpaceInviteExpired(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __sp3MswInstalled?: boolean;
      __sp3MswTimer?: number;
      __sp3MswError?: string;
    };
    if (!win.__msw) {
      if (!win.__sp3MswTimer) {
        let attempts = 0;
        win.__sp3MswTimer = window.setInterval(() => {
          if (install()) {
            window.clearInterval(win.__sp3MswTimer);
            return;
          }
          if (++attempts > 300) {
            window.clearInterval(win.__sp3MswTimer);
            win.__sp3MswError = "[SP3] MSW worker 未在 3 秒内就绪";
          }
        }, 10);
      }
      return false;
    }
    if (win.__sp3MswInstalled) return true;
    const expired = () => win.__msw!.HttpResponse.json(
      { code: 41001, message: "邀请码已过期" },
      { status: 410 },
    );
    win.__msw.worker.use(
      win.__msw.http.get("*/space/invite/SP3-EXPIRED", expired),
      win.__msw.http.get("*/api/v1/space/invite/SP3-EXPIRED", expired),
    );
    win.__sp3MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
