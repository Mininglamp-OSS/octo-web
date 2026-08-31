/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S27: Summary 列表首次加载失败，重试后恢复. */
export async function registerS27SummaryListLoadFailureRetry(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S27] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const item = {
      task_id: 27027,
      task_no: "S27-TASK-27027",
      title: "S27 重试后恢复总结",
      topic: "S27 重试后恢复总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-25T00:00:00Z",
      time_range_end: "2026-08-26T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s27-retry-group", source_name: "S27 恢复验证群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: "2026-08-26T09:00:00Z" }],
      total_msg_count: 6,
      creator_name: "E2E Tester",
      origin_channel_id: "s27-retry-group",
      origin_channel_type: 2,
      created_at: "2026-08-26T09:00:00Z",
      completed_at: "2026-08-26T09:01:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 27027,
      current_personal_version_id: null,
      activity_at: "2026-08-26T09:01:00Z",
    };
    (window as unknown as { __s27RetryRequested?: boolean }).__s27RetryRequested = false;

    const list = () => {
        if (!(window as unknown as { __s27RetryRequested?: boolean }).__s27RetryRequested) {
          return HttpResponse.json({ code: 0, message: "service unavailable" }, { status: 503 });
        }
        return env({ items: [item], total: 1, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
    };
    const templates = () =>
      env({ templates: [], custom_template_limit: 30 });

    worker.use(
      http.get("*/summary/api/v1/summaries", list),
      http.get("*/api/v1/summaries", list),
      http.get("*/summary/api/v1/summary-templates", () =>
        templates()
      ),
      http.get("*/api/v1/summary-templates", templates),
    );
  });
}
