import type { Page } from "@playwright/test";

/** SP1: no-space gate followed by a successful Space creation. */
export async function registerSP1SpaceGateCreate(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: unknown) => unknown) => unknown;
        post: (path: string, resolver: (info: unknown) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: Msw; __sp1MswInstalled?: boolean; __sp1MswTimer?: number; __sp1MswError?: string };
    const msw = win.__msw;
    if (!msw) {
      if (!win.__sp1MswTimer) {
        let attempts = 0;
        win.__sp1MswTimer = window.setInterval(() => {
          if (++attempts > 300) {
            window.clearInterval(win.__sp1MswTimer);
            win.__sp1MswError = "[SP1] MSW worker 未在 3 秒内就绪";
          }
          if (install()) window.clearInterval(win.__sp1MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__sp1MswInstalled) return true;

    const space = {
      space_id: "sp1-created-space", name: "SP1 新组织", description: "", logo: "",
      create_at: "2026-08-25T00:00:00Z", update_at: "2026-08-25T00:00:00Z",
      space_no: "sp1-created-space", owner: "e2e-user-1", status: 1, role: 2,
    };
    msw.worker.use(
      msw.http.get("*/space/my", () =>
        msw.HttpResponse.json(sessionStorage.getItem("__e2e_scenario") === "sp1-space-gate-created" ? [space] : [])
      ),
      msw.http.post("*/space/create", async ({ request }: { request: Request }) => {
        const body = await request.json().catch(() => null) as { name?: string } | null;
        if (body?.name !== space.name) return msw.HttpResponse.json({ msg: "invalid space name" }, { status: 400 });
        sessionStorage.setItem("__e2e_scenario", "sp1-space-gate-created");
        return msw.HttpResponse.json({ space_id: space.space_id, name: space.name });
      }),
      msw.http.post("*/space/sp1-created-space/invite", () =>
        msw.HttpResponse.json({ invite_code: "sp1-invite", invite_url: "https://example.test/invite/sp1-invite" })
      ),
    );
    win.__sp1MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
