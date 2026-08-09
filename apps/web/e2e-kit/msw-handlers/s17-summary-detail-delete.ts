/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S17: Summary 详情页删除总结. */
export async function registerS17SummaryDetailDelete(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
        delete: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S17] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 17017;
    const now = "2026-08-06T17:10:00Z";
    const source = { source_type: 1, source_id: "s17-delete-group", source_name: "S17 删除项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S17-TASK-17017",
      title: "S17 待删除总结",
      topic: "S17 待删除总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 14,
      creator_name: "E2E Tester",
      origin_channel_id: "s17-delete-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T17:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 170171,
      current_personal_version_id: null,
      activity_at: "2026-08-06T17:12:00Z",
    };
    const detail = {
      ...listItem,
      result_id: 170171,
      updated_at: "2026-08-06T17:12:30Z",
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
        content: "## S17 待删除总结\n\n- S17 删除前正文内容\n",
        abstract: "S17 删除前摘要。",
        total_msg_count: 14,
        total_token_used: 1000,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T17:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s17State__: { deleted: boolean } }).__s17State__ = { deleted: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s17State__: { deleted: boolean } }).__s17State__;
        return env({
          items: state.deleted ? [] : [listItem],
          total: state.deleted ? 0 : 1,
          attention_count: 0,
          unread_count: state.deleted ? 0 : 1,
          pending_invitation_count: 0,
        });
      }),
      http.get("*/summary/api/v1/summaries/17017", () => env(detail)),
      http.post("*/summary/api/v1/summaries/17017/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/17017/versions", () =>
        env({ versions: [], keep_limit: 3 })
      ),
      http.delete("*/summary/api/v1/summaries/17017", () => {
        const state = (window as unknown as { __s17State__: { deleted: boolean } }).__s17State__;
        state.deleted = true;
        return env({});
      })
    );
  });
}
