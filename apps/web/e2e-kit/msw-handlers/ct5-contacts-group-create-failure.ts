import type { Page } from "@playwright/test";

export async function registerCT5ContactsGroupCreateFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: () => unknown) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (globalThis as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[CT5] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/space/e2e-space-001/members", () =>
        msw.HttpResponse.json([
          { uid: "e2e-user-2", name: "E2E 建群成员", status: 1, robot: 0 },
        ]),
      ),
      msw.http.post("*/group/create", () =>
        msw.HttpResponse.json(
          { error: { message: "创建群聊失败" } },
          { status: 400 },
        ),
      ),
    );
  });
}
