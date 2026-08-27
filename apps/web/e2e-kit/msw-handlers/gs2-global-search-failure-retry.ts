/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** GS2: 全局搜索失败后修改关键词恢复. */
export async function registerGS2GlobalSearchFailureRetry(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { post: (path: string, resolver: (info: { request: Request }) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[GS2] MSW worker 未就绪");
    const state = { failureCalls: 0 };
    const responseFor = async (request: Request) => {
      const body = await request.json().catch(() => null) as { keyword?: string } | null;
      const keyword = body?.keyword || "";
      if (keyword === "E2E 搜索失败") {
        state.failureCalls += 1;
        if (state.failureCalls === 1) {
          return msw.HttpResponse.json({ code: 0, message: "service unavailable" }, { status: 503 });
        }
      }
      if (keyword === "E2E 搜索恢复") {
        return msw.HttpResponse.json({
          friends: [{ channel_id: "gs2-contact", channel_type: 1, channel_name: "GS2 恢复联系人" }],
          groups: [],
          messages: [],
        });
      }
      return msw.HttpResponse.json({ friends: [], groups: [], messages: [] });
    };
    msw.worker.use(
      msw.http.post("*/search/global", async ({ request }) => responseFor(request))
    );
  });
}
