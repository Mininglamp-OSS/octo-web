/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S16: Summary 详情按意见调整. */
export async function registerS16SummaryDetailRefine(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: {
        json: (body: unknown, init?: unknown) => unknown;
        text: (body: string, init?: unknown) => unknown;
      };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S16] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 16016;
    const now = "2026-08-06T16:10:00Z";
    const listItem = {
      task_id: taskId,
      task_no: "S16-TASK-16016",
      title: "S16 可调整总结",
      topic: "S16 可调整总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s16-refine-group", source_name: "S16 调整项目群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 23,
      creator_name: "E2E Tester",
      origin_channel_id: "s16-refine-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T16:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 160161,
      current_personal_version_id: null,
      activity_at: "2026-08-06T16:12:00Z",
    };
    const detail = {
      ...listItem,
      result_id: 160161,
      updated_at: "2026-08-06T16:12:30Z",
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
        content: "## S16 可调整总结\n\n- S16 原始正文内容\n",
        abstract: "S16 原始摘要。",
        total_msg_count: 23,
        total_token_used: 1500,
        model_version: "e2e-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T16:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => env({ items: [listItem], total: 1, attention_count: 0, unread_count: 1, pending_invitation_count: 0 })),
      http.get("*/summary/api/v1/summaries/16016", () => env(detail)),
      http.post("*/summary/api/v1/summaries/16016/read", () => env({ is_unread: false, has_pending_invitation: false, needs_attention: false })),
      http.get("*/summary/api/v1/summaries/16016/versions", () => env({ versions: [], keep_limit: 3 })),
      http.post("*/summary/api/v1/summaries/16016/refine/stream", () => {
        const body = [
          "event: done",
          'data: {"type":"done","task_id":16016,"result_id":160162,"version":2,"content":"## S16 可调整总结\\n\\n- S16 已按意见调整正文\\n","total_msg_count":23,"total_token_used":1600,"model_version":"e2e-summary-model","operation_type":"refine","operation_note":"S16 请补充风险说明","generated_at":"2026-08-06T16:18:00Z","citations":[],"team_citations":[]}',
          "",
        ].join("\n");
        return HttpResponse.text(body, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  });
}
