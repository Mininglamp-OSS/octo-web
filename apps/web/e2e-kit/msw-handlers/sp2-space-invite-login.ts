import type { Page } from "@playwright/test";

export async function registerSP2SpaceInviteLogin(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: unknown) => unknown) => unknown;
        post: (path: string, resolver: (info: unknown) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: Msw; __sp2MswInstalled?: boolean; __sp2MswTimer?: number; __sp2MswError?: string };
    const msw = win.__msw;
    if (!msw) {
      if (!win.__sp2MswTimer) {
        let attempts = 0;
        win.__sp2MswTimer = window.setInterval(() => {
          if (++attempts > 300) {
            window.clearInterval(win.__sp2MswTimer);
            win.__sp2MswError = "[SP2] MSW worker 未在 3 秒内就绪";
          }
          if (install()) window.clearInterval(win.__sp2MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__sp2MswInstalled) return true;

    const space = { space_id: "sp2-invite-space", name: "SP2 邀请空间", space_no: "sp2-invite-space", description: "", logo: "", owner: "e2e-user-1", status: 1, role: 2 };
    msw.worker.use(
      msw.http.post("*/user/login", async ({ request }: { request: Request }) => {
        const body = await request.json().catch(() => null) as { username?: string; password?: string } | null;
        if (body?.username !== "e2e@example.com" || body?.password !== "e2e-password") return msw.HttpResponse.json({ msg: "invalid credentials" }, { status: 401 });
        return msw.HttpResponse.json({ uid: "e2e-user-1", token: "e2e-mock-token", app_id: "e2e-app", short_no: "10000", name: "E2E Tester", sex: 1 });
      }),
      msw.http.post("*/user/emaillogin", async ({ request }: { request: Request }) => {
        const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
        if (body?.email !== "e2e@example.com" || body?.password !== "e2e-password") return msw.HttpResponse.json({ msg: "invalid credentials" }, { status: 401 });
        return msw.HttpResponse.json({ uid: "e2e-user-1", token: "e2e-mock-token", app_id: "e2e-app", short_no: "10000", name: "E2E Tester", sex: 1 });
      }),
      msw.http.get("*/space/invite/SP2-INVITE", () => msw.HttpResponse.json({ invite_code: "SP2-INVITE", space_id: space.space_id, space_name: space.name, member_count: 1, max_users: 100 })),
      msw.http.get("*/space/my", () => msw.HttpResponse.json(sessionStorage.getItem("__sp2_joined") === "1" ? [space] : [])),
      msw.http.post("*/space/join", async ({ request }: { request: Request }) => {
        const body = await request.json().catch(() => null) as { invite_code?: string } | null;
        if (body?.invite_code !== "SP2-INVITE") return msw.HttpResponse.json({ msg: "invalid invite code" }, { status: 400 });
        sessionStorage.setItem("__sp2_joined", "1");
        return msw.HttpResponse.json({ space_id: space.space_id, status: "JOINED" });
      }),
    );
    win.__sp2MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
