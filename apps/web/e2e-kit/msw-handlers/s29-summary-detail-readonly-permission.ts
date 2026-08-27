/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
import { registerS15SummaryDetailEditSave } from "./s15-summary-detail-edit-save";

/** S29: 复用已完成详情 fixture，仅切换为只读权限。 */
export async function registerS29SummaryDetailReadonlyPermission(page: Page): Promise<void> {
  await registerS15SummaryDetailEditSave(page);
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: (info: unknown) => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S29] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/summary/api/v1/summaries", () =>
        msw.HttpResponse.json({
          code: 0,
          message: "ok",
          data: {
            items: [{ task_id: 15015, task_no: "S29-TASK-15015", title: "S29 只读总结", topic: "S29 只读总结", summary_mode: 1, status: 3, trigger_type: 1, creator_id: "s29-creator", creator_name: "S29 Creator", sources: [{ source_type: 1, source_id: "s29-group", source_name: "S29 只读项目群" }], participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: "2026-08-06T15:12:00Z" }], total_msg_count: 27, origin_channel_id: "s29-group", origin_channel_type: 2, created_at: "2026-08-06T15:10:00Z", completed_at: "2026-08-06T15:12:00Z", is_unread: false, has_pending_invitation: false, has_pending_submission: false, needs_attention: false, current_result_id: 150151, current_personal_version_id: null, activity_at: "2026-08-06T15:12:00Z" }], total: 1, attention_count: 0, unread_count: 0, pending_invitation_count: 0,
          },
        })
      ),
      msw.http.get("*/summary/api/v1/summaries/15015", () =>
        msw.HttpResponse.json({
          code: 0,
          message: "ok",
          data: {
            task_id: 15015,
            task_no: "S29-TASK-15015",
            title: "S29 只读总结",
            topic: "S29 只读总结",
            summary_mode: 1,
            status: 3,
            trigger_type: 1,
            creator_id: "s29-creator",
            creator_name: "S29 Creator",
            sources: [{ source_type: 1, source_id: "s29-group", source_name: "S29 只读项目群" }],
            participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: "2026-08-06T15:12:00Z" }],
            total_msg_count: 27,
            origin_channel_id: "s29-group",
            origin_channel_type: 2,
            created_at: "2026-08-06T15:10:00Z",
            completed_at: "2026-08-06T15:12:00Z",
            updated_at: "2026-08-06T15:12:30Z",
            result_id: 150151,
            error_message: null,
            result_edited_at: null,
            result_is_edited: false,
            permissions: { can_edit: false, can_schedule: false, can_edit_team: false, can_edit_personal: false, can_view_schedule: true, can_add_member: false, can_remove_member: false },
            result: { content: "## S29 只读总结\n\n- S29 只读正文内容\n", abstract: "S29 只读摘要", total_msg_count: 27, total_token_used: 1700, model_version: "e2e-summary-model", version: 1, operation_type: "generate", operation_note: "初始生成", parent_result_id: null, generated_at: "2026-08-06T15:12:00Z", citations: [], team_citations: [] },
          },
        })
      )
    );
  });
}
