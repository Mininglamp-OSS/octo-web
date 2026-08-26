/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- browser-side MSW bridge */
import type { Page } from "@playwright/test";

/** TES19: sidebar 快捷静音的账号级状态 handler。 */
export async function registerTES19SettingsCenterQuickMute(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        put: (path: string, resolver: (info: any) => unknown) => unknown;
        delete: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[TES19] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const state = { paused: false, revision: 1900 };
    const response = () => ({
      paused: state.paused,
      paused_until: state.paused ? new Date(Date.now() + 30 * 60_000).toISOString() : null,
      mode: state.paused ? "timed" : null,
      revision: state.revision,
      server_time: new Date().toISOString(),
    });

    worker.use(
      http.get("*/user/notification-pause", () => HttpResponse.json(response())),
      http.put("*/user/notification-pause", async ({ request }: any) => {
        const body = await request.json();
        if (body?.duration !== "30m") {
          return HttpResponse.json({ error: "TES19 expected a 30-minute pause" }, { status: 400 });
        }
        state.paused = true;
        state.revision += 1;
        return HttpResponse.json(response());
      }),
      http.delete("*/user/notification-pause", () => {
        state.paused = false;
        state.revision += 1;
        return HttpResponse.json(response());
      }),
    );
  });
}
