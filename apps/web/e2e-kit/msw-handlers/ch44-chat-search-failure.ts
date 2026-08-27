import type { Page } from "@playwright/test";

export async function registerCH44ChatSearchFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { post: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown, init?: unknown) => unknown } };
    const msw = (globalThis as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[CH44] MSW worker 未就绪");
    msw.worker.use(msw.http.post("*/messages/_search_all", () => msw.HttpResponse.json({ msg: "search failed" }, { status: 500 })));
  });
}
