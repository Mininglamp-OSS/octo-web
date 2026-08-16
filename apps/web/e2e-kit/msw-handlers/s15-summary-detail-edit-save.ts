/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S15: Summary 详情编辑取消 / 保存. */
export async function registerS15SummaryDetailEditSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
        put: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S15] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 15015;
    const resultId = 150151;
    const now = "2026-08-06T15:10:00Z";
    const source = { source_type: 1, source_id: "s15-edit-group", source_name: "S15 编辑项目群" };
    const listItem = {
      task_id: taskId,
      task_no: "S15-TASK-15015",
      title: "S15 可编辑总结",
      topic: "S15 可编辑总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 27,
      creator_name: "E2E Tester",
      origin_channel_id: "s15-edit-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T15:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: resultId,
      current_personal_version_id: null,
      activity_at: "2026-08-06T15:12:00Z",
    };
    const makeDetail = (savedContent: string | null) => ({
      ...listItem,
      result_id: resultId,
      updated_at: savedContent ? "2026-08-06T15:18:30Z" : "2026-08-06T15:12:30Z",
      error_message: null,
      result_edited_at: savedContent ? "2026-08-06T15:18:00Z" : null,
      result_is_edited: Boolean(savedContent),
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
        content: savedContent
          ? `## S15 可编辑总结\n\n- ${savedContent}\n- 保存后的正文已重新加载\n`
          : "## S15 可编辑总结\n\n- S15 原始正文内容\n- 原始内容用于验证取消不保存\n",
        abstract: savedContent ? "S15 编辑保存成功。" : "S15 原始摘要。",
        total_msg_count: 27,
        total_token_used: 1700,
        model_version: "e2e-summary-model",
        version: savedContent ? 2 : 1,
        operation_type: savedContent ? "manual_edit" : "generate",
        operation_note: savedContent ? "手动编辑" : "初始生成",
        parent_result_id: null,
        generated_at: savedContent ? "2026-08-06T15:18:00Z" : "2026-08-06T15:12:00Z",
        citations: [],
        team_citations: [],
      },
    });

    (window as unknown as { __s15State__: { savedContent: string | null; editCalls: number } }).__s15State__ = {
      savedContent: null,
      editCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () =>
        env({ items: [listItem], total: 1, attention_count: 0, unread_count: 1, pending_invitation_count: 0 })
      ),
      http.get("*/summary/api/v1/summaries/15015", () => {
        const state = (window as unknown as { __s15State__: { savedContent: string | null } }).__s15State__;
        return env(makeDetail(state.savedContent));
      }),
      http.post("*/summary/api/v1/summaries/15015/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/15015/versions", () =>
        env({ versions: [], keep_limit: 3 })
      ),
      http.put("*/summary/api/v1/summaries/15015/edit", async ({ request }: any) => {
        const state = (window as unknown as { __s15State__: { savedContent: string | null; editCalls: number } }).__s15State__;
        state.editCalls += 1;
        const body = await request.json();
        state.savedContent = String(body.content || "").includes("S15 已保存正文内容")
          ? "S15 已保存正文内容"
          : String(body.content || "");
        return env({ edited_at: "2026-08-06T15:18:00Z" });
      })
    );
  });
}
