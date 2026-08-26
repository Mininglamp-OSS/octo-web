/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S5: Summary 选择聊天 + 输入主题 + 创建成功. */
export async function registerS5SummaryCreateBasic(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S5] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 9501;
    const now = "2026-08-05T08:30:00Z";
    const source = { source_type: 1, source_id: "s5-project-group", source_name: "S5 项目群" };
    const detail = {
      task_id: taskId,
      task_no: "S5-TASK-9501",
      title: "S5 项目复盘总结",
      topic: "S5 项目复盘总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-04T00:00:00Z",
      time_range_end: "2026-08-05T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 16,
      creator_name: "E2E Tester",
      origin_channel_id: "s5-project-group",
      origin_channel_type: 2,
      created_at: now,
      updated_at: "2026-08-05T08:35:30Z",
      completed_at: "2026-08-05T08:35:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 8501,
      current_personal_version_id: null,
      activity_at: "2026-08-05T08:35:00Z",
      result_id: 8501,
      result_edited_at: null,
      result_is_edited: false,
      error_message: null,
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
        content: "## S5 创建结果\n\n- 已选择 S5 项目群\n- 已生成复盘总结\n",
        abstract: "S5 创建流程已完成，已进入新总结详情。",
        total_msg_count: 16,
        total_token_used: 1024,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-05T08:35:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s5State__: { listCalls: number; createCalls: number } }).__s5State__ = {
      listCalls: 0,
      createCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s5State__: { listCalls: number } }).__s5State__;
        state.listCalls += 1;
        return env({ items: [], total: 0, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/summary-chat-candidates", () =>
        env([
          {
            chat_id: "s5-project-group",
            chat_type: "group",
            name: "S5 项目群",
            member_count: 5,
            is_archived: false,
          },
        ])
      ),
      http.post("*/sidebar/sync", () =>
        HttpResponse.json({ items: [], version: 0, follow_version: 0 })
      ),
      http.post("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s5State__: { createCalls: number } }).__s5State__;
        state.createCalls += 1;
        return env({ task_id: taskId });
      }),
      http.get("*/summary/api/v1/summaries/9501", () => env(detail)),
      http.post("*/summary/api/v1/summaries/9501/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/9501/versions", () =>
        env({ versions: [], keep_limit: 3 })
      )
    );
  });
}
