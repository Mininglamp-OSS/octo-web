/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S23: 聊天内 Summary Panel 新建后刷新历史列表. */
export async function registerS23SummaryChatPanelCreateRefresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S23] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 23023;
    const now = "2026-08-06T23:23:00Z";
    const source = { source_type: 1, source_id: "s23-project-group", source_name: "S23 项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S23-TASK-23023",
      title: "S23 聊天内新建总结",
      topic: "S23 聊天内新建总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 20,
      creator_name: "E2E Tester",
      origin_channel_id: "s23-project-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T23:25:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 230231,
      current_personal_version_id: null,
      activity_at: "2026-08-06T23:25:00Z",
    };
    (window as unknown as { __s23State__: { created: boolean } }).__s23State__ = { created: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const state = (window as unknown as { __s23State__: { created: boolean } }).__s23State__;
        const url = new URL(request.url);
        const matched = url.searchParams.get("origin_channel_id") === "s23-project-group";
        return env({ items: matched && state.created ? [listItem] : [], total: matched && state.created ? 1 : 0, attention_count: 0, unread_count: state.created ? 1 : 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () => env({ templates: [], custom_template_limit: 30 })),
      http.get("*/summary/api/v1/summary-chat-candidates", () => env([])),
      http.post("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s23State__: { created: boolean } }).__s23State__;
        state.created = true;
        return env({ task_id: taskId });
      })
    );
  });
}
