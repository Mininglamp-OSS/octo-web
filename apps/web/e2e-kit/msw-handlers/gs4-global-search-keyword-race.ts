/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- browser-side MSW bridge */
import type { Page } from "@playwright/test";

export async function registerGS4GlobalSearchKeywordRace(
  page: Page
): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        post: (
          path: string,
          resolver: (info: { request: Request }) => unknown
        ) => unknown;
      };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[GS4] MSW worker 未就绪");
    const groupsResponse = async ({ request }: { request: Request }) => {
      const body = (await request.json().catch(() => null)) as {
        sequence?: number;
      } | null;
      return msw.HttpResponse.json({
        data: { sequence: body?.sequence ?? 1, total_groups: 0, groups: [] },
        pagination: { has_more: false },
      });
    };
    const filesResponse = () =>
      msw.HttpResponse.json({ data: [], pagination: { has_more: false } });
    msw.worker.use(
      msw.http.post("*/search/global", async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          keyword?: string;
        } | null;
        const keyword = body?.keyword ?? "";
        if (keyword === "E2E 旧关键词")
          await new Promise((resolve) => setTimeout(resolve, 900));
        if (keyword === "E2E 新关键词") {
          return msw.HttpResponse.json({
            friends: [
              {
                channel_id: "gs4-new",
                channel_type: 1,
                channel_name: "GS4 新结果",
              },
            ],
            groups: [],
            messages: [],
          });
        }
        if (keyword === "E2E 旧关键词") {
          return msw.HttpResponse.json({
            friends: [
              {
                channel_id: "gs4-old",
                channel_type: 1,
                channel_name: "GS4 旧结果",
              },
            ],
            groups: [],
            messages: [],
          });
        }
        return msw.HttpResponse.json({ friends: [], groups: [], messages: [] });
      }),
      msw.http.post("*/_search_global_groups", groupsResponse),
      msw.http.post("*/api/v1/messages/_search_global_groups", groupsResponse),
      msw.http.post("*/_search_global_files", filesResponse),
      msw.http.post("*/api/v1/messages/_search_global_files", filesResponse)
    );
  });
}
