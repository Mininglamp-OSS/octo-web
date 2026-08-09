/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S19 task ID (in-progress, cancellable). */
export const S19_TASK_ID = 19019;

/** S19: Summary 列表生成中任务取消. */
export async function registerS19SummaryListCancelTask(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S19] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = TASK_ID;
    const now = "2026-08-06T19:10:00Z";
    const makeItem = (status: number) => ({
      task_id: taskId,
      task_no: "S19-TASK-19019",
      title: "S19 可取消总结",
      topic: "S19 可取消总结",
      summary_mode: 1,
      status,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s19-cancel-group", source_name: "S19 取消项目群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 15,
      creator_name: "E2E Tester",
      origin_channel_id: "s19-cancel-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: status === 5 ? null : null,
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: null,
      current_personal_version_id: null,
      activity_at: "2026-08-06T19:12:00Z",
    });
    (window as unknown as { __s19State__: { cancelled: boolean } }).__s19State__ = { cancelled: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s19State__: { cancelled: boolean } }).__s19State__;
        return env({ items: [makeItem(state.cancelled ? 5 : 2)], total: 1, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.post(`*/summary/api/v1/summaries/${TASK_ID}/cancel`, () => {
        const state = (window as unknown as { __s19State__: { cancelled: boolean } }).__s19State__;
        state.cancelled = true;
        return env({});
      }),
      http.post("*/summary/api/v1/summaries/batch-status", () => {
        const state = (window as unknown as { __s19State__: { cancelled: boolean } }).__s19State__;
        return env({ tasks: [{ id: taskId, status: state.cancelled ? 5 : 2 }] });
      })
    );
  }, [S19_TASK_ID]);
}
