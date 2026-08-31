/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
import { registerS25SummaryInviteRespond } from "./s25-summary-invite-respond";

/** S28: 复用邀请列表 fixture，仅将响应接口切换为业务失败. */
export async function registerS28SummaryInviteRespondFailure(page: Page): Promise<void> {
  await registerS25SummaryInviteRespond(page);
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { post: (path: string, resolver: (info: unknown) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S28] MSW worker 未就绪");
    msw.worker.use(
      msw.http.post("*/summary/api/v1/summaries/:taskId/respond", () =>
        msw.HttpResponse.json({ code: 50001, message: "操作失败", data: null }, { status: 500 })
      )
    );
  });
}
