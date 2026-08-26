/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S7: Summary 详情页定时信息展示. */
export async function registerS7SummaryScheduleList(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S7] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 9701;
    const scheduleId = 9701;
    const now = "2026-08-05T09:30:00Z";
    const source = { source_type: 1, source_id: "s7-project-group", source_name: "S7 项目群" };
    const item = {
      task_id: taskId,
      task_no: "S7-TASK-9701",
      title: "S7 定时项目总结",
      topic: "S7 定时项目总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: scheduleId,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-04T00:00:00Z",
      time_range_end: "2026-08-05T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 20,
      creator_name: "E2E Tester",
      origin_channel_id: "s7-project-group",
      origin_channel_type: 2,
      created_at: now,
      updated_at: "2026-08-05T09:35:00Z",
      completed_at: "2026-08-05T09:35:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 8701,
      current_personal_version_id: null,
      activity_at: "2026-08-05T09:35:00Z",
    };
    const detail = {
      ...item,
      result_id: 8701,
      error_message: null,
      result_edited_at: null,
      result_is_edited: false,
      permissions: {
        can_edit: true,
        can_schedule: true,
        can_edit_team: true,
        can_edit_personal: false,
        can_view_schedule: true,
        can_add_member: true,
        can_remove_member: true,
      },
      result: {
        content: "## S7 定时总结\n\n- 定时配置正常展示\n",
        abstract: "S7 定时信息已展示。",
        total_msg_count: 20,
        total_token_used: 1024,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-05T09:35:00Z",
        citations: [],
        team_citations: [],
      },
    };
    const schedule = {
      schedule_id: scheduleId,
      title: "S7 每周项目总结",
      generation_instruction: "每周整理项目进展",
      summary_mode: 1,
      cron_expr: "",
      interval_days: 7,
      interval_months: 0,
      day_of_week: 1,
      day_of_month: 0,
      run_time: "09:30",
      time_range_type: 2,
      sources: [source],
      participants: [{ user_id: "e2e-user-1" }],
      is_active: true,
      next_run_at: "2026-08-11T01:30:00Z",
      created_at: now,
      updated_at: now,
      confirm_policy: 0,
      participant_config: { participants: [{ user_id: "e2e-user-1", confirmed: true }], confirm_gate_passed: true },
    };

    (window as unknown as { __s7State__: { listCalls: number; detailCalls: number; scheduleCalls: number } }).__s7State__ = {
      listCalls: 0,
      detailCalls: 0,
      scheduleCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s7State__: { listCalls: number } }).__s7State__;
        state.listCalls += 1;
        return env({ items: [item], total: 1, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summaries/9701", () => {
        const state = (window as unknown as { __s7State__: { detailCalls: number } }).__s7State__;
        state.detailCalls += 1;
        return env(detail);
      }),
      http.get("*/summary/api/v1/summary-schedules/9701", () => {
        const state = (window as unknown as { __s7State__: { scheduleCalls: number } }).__s7State__;
        state.scheduleCalls += 1;
        return env(schedule);
      }),
      http.post("*/summary/api/v1/summaries/9701/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/9701/versions", () =>
        env({ versions: [], keep_limit: 3 })
      ),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
