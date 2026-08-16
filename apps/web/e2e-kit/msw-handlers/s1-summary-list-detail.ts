/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/**
 * S1: Summary 列表 → 已完成卡片 → 详情读链路.
 *
 * 覆盖 endpoints:
 *   GET  /summary/api/v1/summaries — 列表页已完成总结卡片
 *   GET  /summary/api/v1/summaries/9101 — 详情页摘要和正文
 *   POST /summary/api/v1/summaries/9101/read — 详情页 mark-read
 *   GET  /summary/api/v1/summaries/9101/versions — 已完成详情版本列表
 *
 * state 挂 window.__s1State__ 供调试.
 */

export async function registerS1SummaryListDetail(page: Page): Promise<void> {
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
    if (!msw) {
      throw new Error("[S1] MSW worker 未就绪 (等 __MSW_READY__).");
    }
    const { worker, http, HttpResponse } = msw;

    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 9101;
    const now = "2026-08-04T08:30:00Z";
    const summaryListItem = {
      task_id: taskId,
      task_no: "S1-TASK-9101",
      title: "S1 项目进展总结",
      topic: "S1 项目进展总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-03T00:00:00Z",
      time_range_end: "2026-08-04T00:00:00Z",
      sources: [
        {
          source_type: 1,
          source_id: "s1-summary-group",
          source_name: "S1 项目群",
        },
      ],
      participants: [
        {
          user_id: "e2e-user-1",
          user_name: "E2E Tester",
          status: 1,
          confirmed_at: now,
        },
      ],
      total_msg_count: 24,
      creator_name: "E2E Tester",
      origin_channel_id: "s1-summary-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-04T08:35:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 8101,
      current_personal_version_id: null,
      activity_at: "2026-08-04T08:35:00Z",
    };
    const detail = {
      ...summaryListItem,
      result_id: 8101,
      updated_at: "2026-08-04T08:35:30Z",
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
        content:
          "## S1 项目进展\n\n- 已完成登录态接入\n- 下一步补充 Summary e2e\n",
        abstract: "项目整体进展稳定，当前重点是补齐 Summary e2e 读链路。",
        total_msg_count: 24,
        total_token_used: 2048,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-04T08:35:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s1State__: { listCalls: number; detailCalls: number } }).__s1State__ = {
      listCalls: 0,
      detailCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s1State__: { listCalls: number } }).__s1State__;
        state.listCalls += 1;
        return env({ items: [summaryListItem], total: 1 });
      }),
      http.get("*/summary/api/v1/summaries/9101", () => {
        const state = (window as unknown as { __s1State__: { detailCalls: number } }).__s1State__;
        state.detailCalls += 1;
        return env(detail);
      }),
      http.post("*/summary/api/v1/summaries/9101/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/9101/versions", () =>
        env({ versions: [], keep_limit: 3 })
      ),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
