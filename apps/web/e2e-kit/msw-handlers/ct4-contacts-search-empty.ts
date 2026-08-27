import type { Page } from "@playwright/test";

export async function registerCT4ContactsSearchEmpty(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown) => unknown } };
    const msw = (globalThis as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[CT4] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/space/:spaceId/members", () => msw.HttpResponse.json([
        { uid: "e2e-user-2", name: "E2E 联系人", robot: 0 },
        { uid: "e2e-user-3", name: "其他成员", robot: 0 },
      ])),
      msw.http.get("*/robot/my_bots", () => msw.HttpResponse.json([])),
      msw.http.get("*/robot/space_bots", () => msw.HttpResponse.json([])),
      msw.http.get("*/group/my", () => msw.HttpResponse.json([])),
    );
  });
}
