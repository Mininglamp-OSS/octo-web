import type { Page } from "@playwright/test";

export async function registerCH43ChatAttachmentFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown, init?: unknown) => unknown } };
    const msw = (globalThis as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[CH43] MSW worker 未就绪");
    msw.worker.use(msw.http.get("*/file/upload/credentials", () => msw.HttpResponse.json({ msg: "upload failed" }, { status: 500 })));
  });
}
