/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S18: Summary 列表生成中任务轮询到已完成. */
export async function registerS18SummaryListPollCompleted(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S18] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 18018;
    const now = "2026-08-06T18:10:00Z";
    const source = { source_type: 1, source_id: "s18-poll-group", source_name: "S18 轮询项目群" };
    const makeItem = (status: number) => ({
      task_id: taskId,
      task_no: "S18-TASK-18018",
      title: "S18 轮询总结",
      topic: "S18 轮询总结",
      summary_mode: 1,
      status,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 19,
      creator_name: "E2E Tester",
      origin_channel_id: "s18-poll-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: status === 3 ? "2026-08-06T18:12:00Z" : null,
      is_unread: status === 3,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: status === 3 ? 180181 : null,
      current_personal_version_id: null,
      activity_at: "2026-08-06T18:12:00Z",
    });
    const detail = {
      ...makeItem(3),
      result_id: 180181,
      updated_at: "2026-08-06T18:12:30Z",
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
        content: "## S18 轮询总结\n\n- S18 轮询后已完成\n- 用户可以进入详情查看正文\n",
        abstract: "S18 轮询后已完成。",
        total_msg_count: 19,
        total_token_used: 1300,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T18:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s18State__: { completed: boolean; batchCalls: number } }).__s18State__ = {
      completed: false,
      batchCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s18State__: { completed: boolean } }).__s18State__;
        return env({
          items: [makeItem(state.completed ? 3 : 2)],
          total: 1,
          attention_count: 0,
          unread_count: state.completed ? 1 : 0,
          pending_invitation_count: 0,
        });
      }),
      http.post("*/summary/api/v1/summaries/batch-status", () => {
        const state = (window as unknown as { __s18State__: { completed: boolean; batchCalls: number } }).__s18State__;
        state.batchCalls += 1;
        state.completed = true;
        return env({ tasks: [{ id: taskId, status: 3 }] });
      }),
      http.get("*/summary/api/v1/summaries/18018", () => env(detail)),
      http.post("*/summary/api/v1/summaries/18018/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/18018/versions", () =>
        env({ versions: [], keep_limit: 3 })
      ),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
