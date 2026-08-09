/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S22: 聊天内 Summary Panel 历史列表 → 详情. */
export async function registerS22SummaryChatPanelHistoryDetail(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S22] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 22022;
    const now = "2026-08-06T22:10:00Z";
    const source = { source_type: 1, source_id: "s22-project-group", source_name: "S22 项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S22-TASK-22022",
      title: "S22 聊天内总结",
      topic: "S22 聊天内总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 21,
      creator_name: "E2E Tester",
      origin_channel_id: "s22-project-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T22:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 220221,
      current_personal_version_id: null,
      activity_at: "2026-08-06T22:12:00Z",
    };
    const detail = {
      ...listItem,
      result_id: 220221,
      updated_at: "2026-08-06T22:12:30Z",
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
        content: "## S22 聊天内总结\n\n- S22 聊天内详情正文\n- 当前聊天历史入口可查看详情\n",
        abstract: "S22 聊天内摘要。",
        total_msg_count: 21,
        total_token_used: 1500,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T22:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const url = new URL(request.url);
        const channelId = url.searchParams.get("origin_channel_id");
        const matched = channelId === "s22-project-group";
        return env({
          items: matched ? [listItem] : [],
          total: matched ? 1 : 0,
          attention_count: 0,
          unread_count: matched ? 1 : 0,
          pending_invitation_count: 0,
        });
      }),
      http.get("*/summary/api/v1/summaries/22022", () => env(detail)),
      http.post("*/summary/api/v1/summaries/22022/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/22022/versions", () =>
        env({ versions: [], keep_limit: 3 })
      )
    );
  });
}
