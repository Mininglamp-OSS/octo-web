import type { Page } from "@playwright/test";

export async function registerA2AppbotListRetry(page: Page): Promise<void> {
  function install() {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown, init?: unknown) => unknown } };
    const win = globalThis as unknown as { __msw?: Msw; __a2Installed?: boolean; __a2Timer?: number; __a2RetryRequested?: boolean };
    if (!win.__msw) {
      if (!win.__a2Timer) win.__a2Timer = window.setInterval(() => { if (install()) window.clearInterval(win.__a2Timer); }, 10);
      return false;
    }
    if (win.__a2Installed) return true;
    win.__msw.worker.use(win.__msw.http.get("*/api/v1/app_bot/available", () => {
      if (!win.__a2RetryRequested) {
        return win.__msw!.HttpResponse.json({ msg: "temporary failure" }, { status: 500 });
      }
      return win.__msw!.HttpResponse.json([{ id: "app-docs", uid: "app-docs-bot", display_name: "文档助手", description: "搜索和整理文档", scope: "platform" }]);
    }));
    win.__a2Installed = true;
    return true;
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
