/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S6: Summary 失败详情态. */
export async function registerS6SummaryDetailFailed(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S6] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const now = "2026-08-05T09:30:00Z";
    const item = {
      task_id: 9601,
      task_no: "S6-TASK-9601",
      title: "S6 失败总结",
      topic: "S6 失败总结",
      summary_mode: 1,
      status: 4,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-04T00:00:00Z",
      time_range_end: "2026-08-05T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s6-failed-group", source_name: "S6 异常群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 8,
      creator_name: "E2E Tester",
      origin_channel_id: "s6-failed-group",
      origin_channel_type: 2,
      created_at: now,
      updated_at: "2026-08-05T09:31:00Z",
      completed_at: null,
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: true,
      current_result_id: null,
      current_personal_version_id: null,
      activity_at: "2026-08-05T09:31:00Z",
    };
    const detail = {
      ...item,
      result_id: null,
      error_message: "S6 模拟生成失败：模型服务暂不可用",
      result_edited_at: null,
      result_is_edited: false,
      permissions: {
        can_edit: false,
        can_schedule: false,
        can_edit_team: false,
        can_edit_personal: false,
        can_view_schedule: true,
        can_add_member: false,
        can_remove_member: false,
      },
      result: null,
    };

    (window as unknown as { __s6State__: { listCalls: number; detailCalls: number } }).__s6State__ = {
      listCalls: 0,
      detailCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s6State__: { listCalls: number } }).__s6State__;
        state.listCalls += 1;
        return env({
          items: [item],
          total: 1,
          attention_count: 1,
          unread_count: 0,
          pending_invitation_count: 0,
        });
      }),
      http.get("*/summary/api/v1/summaries/9601", () => {
        const state = (window as unknown as { __s6State__: { detailCalls: number } }).__s6State__;
        state.detailCalls += 1;
        return env(detail);
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
