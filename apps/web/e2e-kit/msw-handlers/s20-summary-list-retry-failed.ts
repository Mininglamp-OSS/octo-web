/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S20 task ID (failed, retryable). */
export const S20_TASK_ID = 20020;

/** S20: Summary 列表失败任务重试. */
export async function registerS20SummaryListRetryFailed(page: Page): Promise<void> {
  await page.evaluate(([TASK_ID]) => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S20] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = TASK_ID;
    const now = "2026-08-06T20:10:00Z";
    const makeItem = (status: number) => ({
      task_id: taskId,
      task_no: "S20-TASK-20020",
      title: "S20 失败可重试总结",
      topic: "S20 失败可重试总结",
      summary_mode: 1,
      status,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s20-retry-group", source_name: "S20 重试项目群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 11,
      creator_name: "E2E Tester",
      origin_channel_id: "s20-retry-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: null,
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: status === 4,
      current_result_id: null,
      current_personal_version_id: null,
      activity_at: "2026-08-06T20:12:00Z",
    });
    (window as unknown as { __s20State__: { retried: boolean } }).__s20State__ = { retried: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s20State__: { retried: boolean } }).__s20State__;
        return env({ items: [makeItem(state.retried ? 2 : 4)], total: 1, attention_count: state.retried ? 0 : 1, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.post(`*/summary/api/v1/summaries/${TASK_ID}/regenerate`, () => {
        const state = (window as unknown as { __s20State__: { retried: boolean } }).__s20State__;
        state.retried = true;
        return env({ task_id: taskId });
      }),
      http.post("*/summary/api/v1/summaries/batch-status", () => {
        const state = (window as unknown as { __s20State__: { retried: boolean } }).__s20State__;
        return env({ tasks: [{ id: taskId, status: state.retried ? 2 : 4 }] });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  }, [S20_TASK_ID]);
}
