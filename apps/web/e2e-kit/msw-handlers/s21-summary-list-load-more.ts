/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S21: Summary 列表滚动加载更多. */
export async function registerS21SummaryListLoadMore(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S21] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const now = "2026-08-06T21:10:00Z";
    const makeItem = (index: number, title: string) => ({
      task_id: 21000 + index,
      task_no: `S21-TASK-${21000 + index}`,
      title,
      topic: title,
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s21-list-group", source_name: "S21 列表项目群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 10 + index,
      creator_name: "E2E Tester",
      origin_channel_id: "s21-list-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T21:12:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 31000 + index,
      current_personal_version_id: null,
      activity_at: "2026-08-06T21:12:00Z",
    });
    const firstPage = Array.from({ length: 20 }, (_, i) =>
      makeItem(i + 1, `S21 第 ${String(i + 1).padStart(2, "0")} 条总结`)
    );
    const secondPage = [makeItem(21, "S21 第二页总结")];

    worker.use(
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") || "1");
        return env({ items: page >= 2 ? secondPage : firstPage, total: 21, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
