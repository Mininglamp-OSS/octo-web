import type { Page } from "@playwright/test";

export async function registerV1ChatVoiceInput(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: (info: unknown) => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: Msw; __v1MswInstalled?: boolean; __v1MswTimer?: number; __v1MswError?: string };
    const msw = win.__msw;
    if (!msw) {
      if (!win.__v1MswTimer) {
        let attempts = 0;
        win.__v1MswTimer = window.setInterval(() => {
          if (++attempts > 300) {
            window.clearInterval(win.__v1MswTimer);
            win.__v1MswError = "[V1] MSW worker 未在 3 秒内就绪";
          }
          if (install()) window.clearInterval(win.__v1MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__v1MswInstalled) return true;
    if (sessionStorage.getItem("__e2e_scenario") !== "v1-chat-voice-input") {
      throw new Error("[V1] 缺少 v1-chat-voice-input scenario");
    }
    msw.worker.use(msw.http.get("*/voice/config", () => msw.HttpResponse.json({ enabled: true, max_file_size: 5_000_000, max_duration: 60 })));
    win.__v1MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
