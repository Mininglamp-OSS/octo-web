/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S8: Summary 创建时选择参与者. */
export async function registerS8SummaryCreateParticipants(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S8] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 9801;
    const now = "2026-08-05T10:30:00Z";
    const source = { source_type: 1, source_id: "s8-project-group", source_name: "S8 项目群" };
    const detail = {
      task_id: taskId,
      task_no: "S8-TASK-9801",
      title: "S8 多人协作总结",
      topic: "S8 多人协作总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-04T00:00:00Z",
      time_range_end: "2026-08-05T00:00:00Z",
      sources: [source],
      participants: [
        { user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now },
        { user_id: "s8-member-a", user_name: "S8 Alice", status: 1, confirmed_at: now },
      ],
      total_msg_count: 18,
      creator_name: "E2E Tester",
      origin_channel_id: "s8-project-group",
      origin_channel_type: 2,
      created_at: now,
      updated_at: "2026-08-05T10:35:00Z",
      completed_at: "2026-08-05T10:35:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 8801,
      current_personal_version_id: null,
      activity_at: "2026-08-05T10:35:00Z",
      result_id: 8801,
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
        content: "## S8 多人协作结果\n\n- 已邀请 S8 Alice 参与总结\n",
        abstract: "S8 多人协作创建完成，参与者已带入总结任务。",
        total_msg_count: 18,
        total_token_used: 1024,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-05T10:35:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s8State__: { listCalls: number; createCalls: number } }).__s8State__ = {
      listCalls: 0,
      createCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s8State__: { listCalls: number } }).__s8State__;
        state.listCalls += 1;
        return env({ items: [], total: 0, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/summary-chat-candidates", () =>
        env([{ chat_id: "s8-project-group", chat_type: "group", name: "S8 项目群", member_count: 3, is_archived: false }])
      ),
      http.post("*/sidebar/sync", () =>
        HttpResponse.json({ items: [], version: 0, follow_version: 0 })
      ),
      http.post("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s8State__: { createCalls: number } }).__s8State__;
        state.createCalls += 1;
        return env({ task_id: taskId });
      }),
      http.get("*/summary/api/v1/summaries/9801", () => env(detail)),
      http.post("*/summary/api/v1/summaries/9801/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/9801/versions", () =>
        env({ versions: [], keep_limit: 3 })
      )
    );
  });
}
