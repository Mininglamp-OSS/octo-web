/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";

export async function registerGS3GlobalSearchFileFilter(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: unknown) => unknown) => unknown;
        post: (path: string, resolver: (info: { request: Request }) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[GS3] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/messages/_search_file_types", () =>
        msw.HttpResponse.json([{ key: "docs", label: "文档", exts: ["pdf", "docx"] }])
      ),
      msw.http.post("*/search/global", () =>
        msw.HttpResponse.json({
          friends: [],
          groups: [],
          messages: [],
        })
      ),
      msw.http.post("*/_search_global_messages", () =>
        msw.HttpResponse.json({ data: [], pagination: { has_more: false } })
      ),
      msw.http.post("*/_search_global_groups", () =>
        msw.HttpResponse.json({ data: { sequence: 1, total_groups: 0, groups: [] }, pagination: { has_more: false } })
      ),
      msw.http.post("*/_search_global_files", async ({ request }) => {
        const body = await request.json().catch(() => ({})) as { file_exts?: string[] };
        const filtered = body.file_exts?.includes("pdf");
        const pdf = { message_id: "gs3-file", message_seq: 2, file_name: "GS3 文件.pdf", file_size_bytes: 1024, file_ext: "pdf", download_url: "https://example.test/gs3-file.pdf", sender_id: "e2e-user-1", sender_name: "E2E Tester", sent_at: "2026-08-25T08:00:00Z", channel_id: "gs3-group", channel_type: 2 };
        const text = { ...pdf, message_id: "gs3-text", file_name: "GS3 其它.txt", file_ext: "txt" };
        return msw.HttpResponse.json({ data: filtered ? [pdf] : [pdf, text], pagination: { has_more: false } });
      })
    );
  });
}
