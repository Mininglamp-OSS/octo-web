/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S4: Summary 列表状态筛选. */
export async function registerS4SummaryListStatusFilter(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S4] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const base = {
      summary_mode: 1,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-03T00:00:00Z",
      time_range_end: "2026-08-04T00:00:00Z",
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1 }],
      total_msg_count: 10,
      creator_name: "E2E Tester",
      origin_channel_type: 2,
      created_at: "2026-08-04T08:30:00Z",
      completed_at: "2026-08-04T08:35:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_personal_version_id: null,
      activity_at: "2026-08-04T08:35:00Z",
    };
    const completed = {
      ...base,
      task_id: 9401,
      task_no: "S4-TASK-9401",
      title: "S4 已完成总结",
      topic: "S4 已完成总结",
      status: 3,
      sources: [{ source_type: 1, source_id: "s4-g-done", source_name: "S4 完成群" }],
      origin_channel_id: "s4-g-done",
      current_result_id: 10401,
    };
    const failed = {
      ...base,
      task_id: 9402,
      task_no: "S4-TASK-9402",
      title: "S4 失败总结",
      topic: "S4 失败总结",
      status: 4,
      completed_at: null,
      sources: [{ source_type: 1, source_id: "s4-g-failed", source_name: "S4 失败群" }],
      origin_channel_id: "s4-g-failed",
      current_result_id: null,
    };
    (window as unknown as { __s4State__: { listCalls: number } }).__s4State__ = { listCalls: 0 };

    worker.use(
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const state = (window as unknown as { __s4State__: { listCalls: number } }).__s4State__;
        state.listCalls += 1;
        const status = new URL(request.url).searchParams.get("status");
        const items = status === "4" ? [failed] : [completed, failed];
        return env({ items, total: items.length });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
