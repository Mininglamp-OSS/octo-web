/* eslint-disable no-undef -- e2e code runs in the browser through MSW */
import type { Page } from "@playwright/test";

export async function registerCh8ChatSidebarBadges(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { post: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[CH8] MSW worker 未就绪");
    msw.worker.use(
      msw.http.post("*/sidebar/sync", () =>
        msw.HttpResponse.json({ items: [], version: 0, follow_version: 0 })
      )
    );
  });
}
