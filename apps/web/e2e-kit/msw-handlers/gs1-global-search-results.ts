import type { Page } from "@playwright/test";

export async function registerGS1GlobalSearchResults(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { post: (path: string, resolver: (info: { request: Request }) => unknown) => unknown }; HttpResponse: { json: (body: unknown) => unknown } };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[GS1] MSW worker 未就绪");
    const keywordMatches = async (request: Request) => {
      const body = await request.json().catch(() => null) as { keyword?: string } | null;
      return body?.keyword === "E2E 全局搜索";
    };
    msw.worker.use(
      msw.http.post("*/search/global", async ({ request }) => msw.HttpResponse.json(await keywordMatches(request) ? {
        friends: [{ channel_id: "gs1-contact", channel_type: 1, channel_name: "GS1 联系人" }], groups: [], messages: [{
          message_id: "gs1-message", message_seq: 1, from_uid: "e2e-user-1",
          channel: { channel_id: "gs1-group", channel_type: 2, channel_name: "GS1 群聊" },
          payload: { type: 1, content: "E2E 全局搜索消息" },
        }],
      } : { friends: [], groups: [], messages: [] })),
      msw.http.post("*/_search_global_messages", async ({ request }) => msw.HttpResponse.json(await keywordMatches(request) ? {
        data: [{ result_type: "message", sorted_at: "2026-08-25T08:00:00Z", message: {
          message_id: "gs1-message", message_seq: 1, message_kind: "text", snippet: "E2E 全局搜索消息", sender_id: "e2e-user-1", sender_name: "E2E Tester", sender_avatar_url: "", sent_at: "2026-08-25T08:00:00Z", channel_id: "gs1-group", channel_type: 2,
        } }], pagination: { has_more: false }
      } : { data: [], pagination: { has_more: false } })),
      msw.http.post("*/_search_global_groups", async ({ request }) => msw.HttpResponse.json(await keywordMatches(request) ? { data: { sequence: 1, total_groups: 1, groups: [{ channel_id: "gs1-group", channel_type: 2, group_name: "GS1 群聊", match_count: 1, latest_at: "2026-08-25T08:00:00Z" }] }, pagination: { has_more: false } } : { data: { sequence: 1, total_groups: 0, groups: [] }, pagination: { has_more: false } })),
      msw.http.post("*/_search_global_files", async ({ request }) => msw.HttpResponse.json(await keywordMatches(request) ? { data: [{ message_id: "gs1-file", message_seq: 2, file_name: "GS1 文件.pdf", file_size_bytes: 1024, file_ext: "pdf", download_url: "https://example.test/gs1-file.pdf", sender_id: "e2e-user-1", sender_name: "E2E Tester", sent_at: "2026-08-25T08:00:00Z", channel_id: "gs1-group", channel_type: 2 }], pagination: { has_more: false } } : { data: [], pagination: { has_more: false } }))
    );
  });
}
