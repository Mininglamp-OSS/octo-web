/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S11: Agent 总结详情 → 继续优化 → 自动引用原总结. */
export async function registerS11SummaryAgentContinueRefine(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S11] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 11011;
    const now = "2026-08-06T11:10:00Z";
    const source = { source_type: 1, source_id: "s11-agent-group", source_name: "S11 Agent 项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S11-TASK-11011",
      title: "S11 Agent 原总结",
      topic: "S11 Agent 原总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 3,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 22,
      creator_name: "E2E Tester",
      origin_channel_id: "s11-agent-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T11:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 11101,
      current_personal_version_id: null,
      activity_at: "2026-08-06T11:12:00Z",
    };
    const detail = {
      ...listItem,
      result_id: 11101,
      updated_at: "2026-08-06T11:12:30Z",
      error_message: null,
      result_edited_at: null,
      result_is_edited: false,
      permissions: {
        can_edit: false,
        can_schedule: false,
        can_edit_team: false,
        can_edit_personal: false,
        can_view_schedule: false,
        can_add_member: false,
        can_remove_member: false,
      },
      result: {
        content: "## S11 Agent 原总结\n\n- S11 原总结风险清单\n- 需要继续优化验收口径\n",
        abstract: "S11 Agent 原总结可继续优化。",
        total_msg_count: 22,
        total_token_used: 1800,
        model_version: "e2e-agent-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T11:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () =>
        env({ items: [listItem], total: 1, attention_count: 0, unread_count: 1, pending_invitation_count: 0 })
      ),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/agent/chat/history", ({ request }: any) => {
        const url = new URL(request.url);
        return env({ session_id: url.searchParams.get("session_id") || "", messages: [] });
      }),
      http.get("*/summary/api/v1/summaries/11011", () => env(detail)),
      http.post("*/summary/api/v1/summaries/11011/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/11011/versions", () =>
        env({ versions: [], keep_limit: 3 })
      )
    );
  });
}
