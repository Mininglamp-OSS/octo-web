import type { Page } from "@playwright/test";

export async function registerA3AppbotConnectFailure(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: () => unknown) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = globalThis as unknown as {
      __msw?: Msw;
      __a3Installed?: boolean;
      __a3Timer?: number;
    };
    if (!win.__msw) {
      if (!win.__a3Timer) {
        win.__a3Timer = window.setInterval(() => {
          if (install()) window.clearInterval(win.__a3Timer);
        }, 10);
      }
      return false;
    }
    if (win.__a3Installed) return true;
    win.__msw.worker.use(
      win.__msw.http.get("*/api/v1/app_bot/available", () =>
        win.__msw!.HttpResponse.json([
          {
            id: "app-docs",
            uid: "app-docs-bot",
            display_name: "文档助手",
            description: "搜索和整理文档",
            scope: "platform",
          },
        ]),
      ),
      win.__msw.http.post("*/api/v1/app_bot/apply", () =>
        win.__msw!.HttpResponse.json(
          { message: "temporary app connection failure" },
          { status: 500 },
        ),
      ),
    );
    win.__a3Installed = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
