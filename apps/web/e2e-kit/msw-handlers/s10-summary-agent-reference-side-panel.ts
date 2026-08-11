/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S10: Agent 总结引用已有总结 + 右侧对照面板. */
export async function registerS10SummaryAgentReferenceSidePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S10] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 10010;
    const now = "2026-08-06T10:10:00Z";
    const listItem = {
      task_id: taskId,
      task_no: "S10-TASK-10010",
      title: "S10 已有客户总结",
      topic: "S10 已有客户总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 3,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s10-customer-group", source_name: "S10 客户群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 12,
      creator_name: "E2E Tester",
      origin_channel_id: "s10-customer-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T10:12:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 100101,
      current_personal_version_id: null,
      activity_at: "2026-08-06T10:12:00Z",
      referenceable: true,
    };
    const detail = {
      ...listItem,
      result_id: 100101,
      updated_at: "2026-08-06T10:12:30Z",
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
        content: "## S10 已有客户总结\n\n- 历史风险需要继续跟进\n- 客户验收口径需要同步\n",
        abstract: "S10 历史总结可作为新 Agent 对话引用。",
        total_msg_count: 12,
        total_token_used: 900,
        model_version: "e2e-agent-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T10:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        return env({
          items: [listItem],
          total: 1,
          attention_count: 0,
          unread_count: 0,
          pending_invitation_count: 0,
        });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/summaries/10010", () => env(detail)),
      http.get("*/summary/api/v1/summaries/10010/personal", () =>
        env({
          id: 100201,
          version: 1,
          worker_status: 2,
          content: "## S10 个人兜底总结\n\n- 历史风险需要继续跟进\n",
          abstract: "S10 个人结果兜底。",
          citations: [],
          submitted_at: "2026-08-06T10:12:00Z",
          generated_at: "2026-08-06T10:12:00Z",
          msg_count: 12,
          current_version_id: 100201,
        })
      )
    );
  });
}
