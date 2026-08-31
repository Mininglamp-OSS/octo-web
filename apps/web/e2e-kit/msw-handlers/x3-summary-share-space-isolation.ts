/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
import { registerS26SummaryStandaloneLinks } from "./s26-summary-standalone-links";

export async function registerX3SummaryShareSpaceIsolation(page: Page): Promise<void> {
  await registerS26SummaryStandaloneLinks(page);
  function install() {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: MSW; __x3Installed?: boolean; __x3Timer?: number };
    const msw = win.__msw;
    if (win.__x3Installed) return true;
    if (!msw) {
      if (!win.__x3Timer) {
        let attempts = 0;
        win.__x3Timer = window.setInterval(() => {
          if (install() || ++attempts > 300) window.clearInterval(win.__x3Timer);
        }, 10);
      }
      return false;
    }
    msw.worker.use(
      msw.http.get("*/summary/api/v1/summary-shares/e2e-share-026", () =>
        msw.HttpResponse.json({ code: 40301, message: "space access denied", data: null }, { status: 403 })
      )
    );
    win.__x3Installed = true;
    return true;
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
