/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S3: Summary 列表搜索. */
export async function registerS3SummaryListSearch(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S3] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const common = {
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-03T00:00:00Z",
      time_range_end: "2026-08-04T00:00:00Z",
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1 }],
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
    const items = [
      {
        ...common,
        task_id: 9301,
        task_no: "S3-TASK-9301",
        title: "S3 周报总结",
        topic: "S3 周报总结",
        total_msg_count: 12,
        sources: [{ source_type: 1, source_id: "s3-g-9301", source_name: "S3 周报群" }],
        origin_channel_id: "s3-g-9301",
        current_result_id: 10301,
      },
      {
        ...common,
        task_id: 9302,
        task_no: "S3-TASK-9302",
        title: "S3 客户反馈总结",
        topic: "S3 客户反馈总结",
        total_msg_count: 18,
        sources: [{ source_type: 1, source_id: "s3-g-9302", source_name: "S3 客户群" }],
        origin_channel_id: "s3-g-9302",
        current_result_id: 10302,
      },
    ];
    (window as unknown as { __s3State__: { listCalls: number } }).__s3State__ = { listCalls: 0 };

    worker.use(
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const state = (window as unknown as { __s3State__: { listCalls: number } }).__s3State__;
        state.listCalls += 1;
        const keyword = new URL(request.url).searchParams.get("keyword") || "";
        const filtered = keyword ? items.filter((item) => item.title.includes(keyword)) : items;
        return env({ items: filtered, total: filtered.length });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
