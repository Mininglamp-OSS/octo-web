/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S14: Summary 版本记录 → 历史预览 → 恢复版本. */
export async function registerS14SummaryDetailVersionRestore(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S14] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 14014;
    const currentResultId = 140142;
    const historyResultId = 140141;
    const restoredResultId = 140143;
    const now = "2026-08-06T14:10:00Z";
    const source = { source_type: 1, source_id: "s14-version-group", source_name: "S14 版本项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S14-TASK-14014",
      title: "S14 版本总结",
      topic: "S14 版本总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 31,
      creator_name: "E2E Tester",
      origin_channel_id: "s14-version-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T14:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: currentResultId,
      current_personal_version_id: null,
      activity_at: "2026-08-06T14:12:00Z",
    };
    const makeDetail = (restored: boolean) => ({
      ...listItem,
      result_id: restored ? restoredResultId : currentResultId,
      updated_at: restored ? "2026-08-06T14:18:30Z" : "2026-08-06T14:12:30Z",
      result_edited_at: null,
      result_is_edited: restored,
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
        content: restored
          ? "## S14 版本总结\n\n- S14 历史版本已恢复\n- 当前正文已切换到恢复后的版本\n"
          : "## S14 版本总结\n\n- S14 当前版本内容\n- 当前版本包含新的风险描述\n",
        abstract: restored ? "S14 已恢复历史版本。" : "S14 当前版本摘要。",
        total_msg_count: 31,
        total_token_used: 2100,
        model_version: "e2e-summary-model",
        version: restored ? 3 : 2,
        operation_type: restored ? "restore" : "refine",
        operation_note: restored ? "恢复自历史版本" : "当前版本",
        parent_result_id: restored ? historyResultId : null,
        generated_at: restored ? "2026-08-06T14:18:00Z" : "2026-08-06T14:12:00Z",
        citations: [],
        team_citations: [],
      },
    });
    const versions = [
      {
        result_id: currentResultId,
        version_id: currentResultId,
        version: 2,
        operation_type: "refine",
        operation_note: "当前版本",
        parent_result_id: historyResultId,
        created_by: "e2e-user-1",
        generated_at: "2026-08-06T14:12:00Z",
      },
      {
        result_id: historyResultId,
        version_id: historyResultId,
        version: 1,
        operation_type: "generate",
        operation_note: "初始生成版本",
        parent_result_id: null,
        created_by: "e2e-user-1",
        generated_at: "2026-08-06T14:00:00Z",
      },
    ];
    const historyDetail = {
      ...versions[1],
      content: "## S14 版本总结\n\n- S14 历史版本内容\n- 历史版本保留原始结论\n",
      citations: [],
      team_citations: [],
    };

    (window as unknown as { __s14State__: { restored: boolean } }).__s14State__ = { restored: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", () =>
        env({ items: [listItem], total: 1, attention_count: 0, unread_count: 1, pending_invitation_count: 0 })
      ),
      http.get("*/summary/api/v1/summaries/14014", () => {
        const state = (window as unknown as { __s14State__: { restored: boolean } }).__s14State__;
        return env(makeDetail(state.restored));
      }),
      http.post("*/summary/api/v1/summaries/14014/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/14014/versions", () =>
        env({ versions, keep_limit: 3 })
      ),
      http.get("*/summary/api/v1/summaries/14014/versions/140141", () => env(historyDetail)),
      http.post("*/summary/api/v1/summaries/14014/versions/140141/restore", () => {
        const state = (window as unknown as { __s14State__: { restored: boolean } }).__s14State__;
        state.restored = true;
        return env({ task_id: taskId, result_id: restoredResultId, version: 3 });
      })
    );
  });
}
