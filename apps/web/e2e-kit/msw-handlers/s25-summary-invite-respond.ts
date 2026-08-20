/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S25 accept-invite task ID. */
export const S25_ACCEPT_TASK_ID = 250251;
/** S25 reject-invite task ID. */
export const S25_REJECT_TASK_ID = 250252;

/** S25: Summary 列表待确认邀请同意 / 拒绝. */
export async function registerS25SummaryInviteRespond(page: Page): Promise<void> {
  await page.evaluate(({ ACCEPT_TASK_ID, REJECT_TASK_ID }) => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S25] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const now = "2026-08-06T23:25:00Z";
    const makeItem = (id: number, title: string, after?: "accepted" | "rejected") => {
      const isPending = !after;
      const status = after === "rejected" ? 5 : after === "accepted" ? 2 : 1;
      return {
        task_id: id,
        task_no: `S25-TASK-${id}`,
        title,
        topic: title,
        summary_mode: 2,
        status,
        trigger_type: 1,
        schedule_id: null,
        creator_id: "s25-creator",
        time_range_start: "2026-08-05T00:00:00Z",
        time_range_end: "2026-08-06T00:00:00Z",
        sources: [{ source_type: 1, source_id: "s25-invite-group", source_name: "S25 邀请项目群" }],
        participants: [
          { user_id: "s25-creator", user_name: "S25 Creator", status: 1, confirmed_at: now },
          { user_id: "e2e-user-1", user_name: "E2E Tester", status: isPending ? 0 : after === "accepted" ? 1 : 2, confirmed_at: after === "accepted" ? now : null },
        ],
        total_msg_count: 12,
        creator_name: "S25 Creator",
        origin_channel_id: "s25-invite-group",
        origin_channel_type: 2,
        created_at: now,
        completed_at: null,
        is_unread: false,
        has_pending_invitation: isPending,
        has_pending_submission: false,
        needs_attention: isPending,
        current_result_id: null,
        current_personal_version_id: null,
        activity_at: now,
      };
    };

    (window as unknown as { __s25State__: { accepted: boolean; rejected: boolean } }).__s25State__ = {
      accepted: false,
      rejected: false,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s25State__: { accepted: boolean; rejected: boolean } }).__s25State__;
        const acceptedItem = makeItem(ACCEPT_TASK_ID, "S25 同意邀请总结", state.accepted ? "accepted" : undefined);
        const rejectedItem = makeItem(REJECT_TASK_ID, "S25 拒绝邀请总结", state.rejected ? "rejected" : undefined);
        return env({ items: [acceptedItem, rejectedItem], total: 2, attention_count: state.accepted && state.rejected ? 0 : 2, unread_count: 0, pending_invitation_count: state.accepted && state.rejected ? 0 : 2 });
      }),
      http.post("*/summary/api/v1/summaries/:taskId/respond", async ({ params, request }: any) => {
        const state = (window as unknown as { __s25State__: { accepted: boolean; rejected: boolean } }).__s25State__;
        const body = await request.json();
        if (String(params.taskId) === String(ACCEPT_TASK_ID) && body.action === "accept") state.accepted = true;
        if (String(params.taskId) === String(REJECT_TASK_ID) && body.action === "reject") state.rejected = true;
        return env({});
      }),
      http.post("*/summary/api/v1/summaries/batch-status", () => {
        const state = (window as unknown as { __s25State__: { accepted: boolean; rejected: boolean } }).__s25State__;
        return env({
          tasks: [
            { id: ACCEPT_TASK_ID, status: state.accepted ? 2 : 1 },
            { id: REJECT_TASK_ID, status: state.rejected ? 5 : 1 },
          ],
        });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  }, { ACCEPT_TASK_ID: S25_ACCEPT_TASK_ID, REJECT_TASK_ID: S25_REJECT_TASK_ID });
}
