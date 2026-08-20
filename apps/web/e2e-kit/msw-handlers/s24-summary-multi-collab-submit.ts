/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S24 task ID. */
export const S24_TASK_ID = 24024;
/** S24 logged-in user ID (the submitter). */
export const S24_MY_USER_ID = "e2e-user-1";
/** S24 other participant user ID. */
export const S24_OTHER_USER_ID = "s24-member-a";

/** S24: 多人 BY_PERSON 个人报告提交. */
export async function registerS24SummaryMultiCollabSubmit(page: Page): Promise<void> {
  await page.evaluate(([TASK_ID, MY_USER_ID, OTHER_USER_ID]) => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S24] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = TASK_ID;
    const now = "2026-08-06T23:10:00Z";
    const source = { source_type: 1, source_id: "s24-multi-group", source_name: "S24 多人项目群" };
    const participants = [
      { user_id: MY_USER_ID, user_name: "E2E Tester", status: 1, confirmed_at: now },
      { user_id: OTHER_USER_ID, user_name: "S24 Alice", status: 1, confirmed_at: now },
    ];
    const listItem = {
      task_id: taskId,
      task_no: "S24-TASK-24024",
      title: "S24 多人协作总结",
      topic: "S24 多人协作总结",
      summary_mode: 2,
      status: 3,
      trigger_type: 1,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants,
      total_msg_count: 33,
      creator_name: "E2E Tester",
      origin_channel_id: "s24-multi-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T23:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: true,
      needs_attention: true,
      current_result_id: 240241,
      current_personal_version_id: 240251,
      activity_at: "2026-08-06T23:12:00Z",
    };
    const makeDetail = (submitted: boolean) => ({
      ...listItem,
      has_pending_submission: !submitted,
      needs_attention: !submitted,
      result_id: submitted ? 240241 : null,
      updated_at: submitted ? "2026-08-06T23:18:30Z" : "2026-08-06T23:12:30Z",
      error_message: null,
      result_edited_at: null,
      result_is_edited: false,
      permissions: {
        can_edit: true,
        can_schedule: true,
        can_edit_team: true,
        can_edit_personal: true,
        can_view_schedule: true,
        can_add_member: true,
        can_remove_member: true,
      },
      result: submitted
        ? {
            content: "## S24 团队汇总\n\n- S24 团队汇总已刷新\n- 所有成员报告已汇入\n",
            abstract: "S24 团队汇总已刷新。",
            total_msg_count: 33,
            total_token_used: 1900,
            model_version: "e2e-summary-model",
            version: 1,
            operation_type: "generate",
            operation_note: "",
            parent_result_id: null,
            generated_at: "2026-08-06T23:18:00Z",
            citations: [],
            team_citations: [],
          }
        : null,
    });
    const makePersonal = (submitted: boolean) => ({
      id: 240251,
      version: 1,
      worker_status: 2,
      content: "## S24 我的个人报告\n\n- S24 我的个人报告内容\n",
      abstract: "S24 我的个人报告摘要。",
      citations: [],
      submitted_at: submitted ? "2026-08-06T23:18:00Z" : null,
      generated_at: "2026-08-06T23:12:00Z",
      msg_count: 17,
      current_version_id: 240251,
    });
    const makeMembers = (submitted: boolean) => ({
      members: [
        {
          user_id: MY_USER_ID,
          user_name: "E2E Tester",
          status: submitted ? "submitted" : "completed",
          submitted_at: submitted ? "2026-08-06T23:18:00Z" : null,
          content: submitted ? "S24 我的个人报告内容" : undefined,
          citations: [],
        },
        {
          user_id: OTHER_USER_ID,
          user_name: "S24 Alice",
          status: "submitted",
          submitted_at: "2026-08-06T23:11:00Z",
          content: "S24 Alice 已提交报告内容",
          citations: [],
        },
      ],
    });

    (window as unknown as { __s24State__: { submitted: boolean } }).__s24State__ = { submitted: false };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => env({ items: [listItem], total: 1, attention_count: 1, unread_count: 1, pending_invitation_count: 0 })),
      http.get(`*/summary/api/v1/summaries/${TASK_ID}`, () => {
        const state = (window as unknown as { __s24State__: { submitted: boolean } }).__s24State__;
        return env(makeDetail(state.submitted));
      }),
      http.get(`*/summary/api/v1/summaries/${TASK_ID}/personal`, () => {
        const state = (window as unknown as { __s24State__: { submitted: boolean } }).__s24State__;
        return env(makePersonal(state.submitted));
      }),
      http.get(`*/summary/api/v1/summaries/${TASK_ID}/members`, () => {
        const state = (window as unknown as { __s24State__: { submitted: boolean } }).__s24State__;
        return env(makeMembers(state.submitted));
      }),
      http.post(`*/summary/api/v1/summaries/${TASK_ID}/submit`, () => {
        const state = (window as unknown as { __s24State__: { submitted: boolean } }).__s24State__;
        state.submitted = true;
        return env({});
      }),
      http.post(`*/summary/api/v1/summaries/${TASK_ID}/read`, () => env({ is_unread: false, has_pending_invitation: false, needs_attention: false })),
      http.get(`*/summary/api/v1/summaries/${TASK_ID}/versions`, () => env({ versions: [], keep_limit: 3 })),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  }, [S24_TASK_ID, S24_MY_USER_ID, S24_OTHER_USER_ID]);
}
