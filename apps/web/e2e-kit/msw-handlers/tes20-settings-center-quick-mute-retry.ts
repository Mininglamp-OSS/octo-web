/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- browser-side MSW bridge */
import type { Page } from "@playwright/test";

/** TES20: 快捷静音首次保存失败，重试成功. */
export async function registerTES20SettingsCenterQuickMuteRetry(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        put: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[TES20] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const state = { paused: false, putCalls: 0 };
    const response = () => ({
      paused: state.paused,
      paused_until: state.paused ? new Date(Date.now() + 30 * 60_000).toISOString() : null,
      mode: state.paused ? "timed" : null,
      revision: state.putCalls,
      server_time: new Date().toISOString(),
    });
    worker.use(
      http.get("*/user/notification-pause", () => HttpResponse.json(response())),
      http.put("*/user/notification-pause", () => {
        state.putCalls += 1;
        if (state.putCalls === 1) return HttpResponse.json({ error: "temporary failure" }, { status: 503 });
        state.paused = true;
        return HttpResponse.json(response());
      })
    );
  });
}
