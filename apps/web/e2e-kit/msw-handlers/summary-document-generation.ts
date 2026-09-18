import type { Page } from "@playwright/test";

/** Read-only document generation fixtures. No real schedule is touched. */
export async function registerDocumentGeneration(
  page: Page,
  options: { scheduled: boolean; ready: boolean }
): Promise<void> {
  await page.evaluate(({ scheduled, ready }) => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: () => unknown) => unknown;
        post: (path: string, resolver: () => unknown) => unknown;
      };
      HttpResponse: {
        json: (body: unknown) => unknown;
        text: (body: string, init?: { headers: Record<string, string> }) => unknown;
      };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("MSW is not ready");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const now = "2026-09-18T01:00:00Z";
    const taskId = 30168;
    const participant = { user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now };
    const task = {
      task_id: taskId, task_no: "DOC-GENERATION", title: "Document generation regression",
      topic: "Document generation regression", summary_mode: 2, status: 1,
      trigger_type: scheduled ? 2 : 1, schedule_id: scheduled ? taskId : null,
      creator_id: participant.user_id, creator_name: participant.user_name,
      sources: [{ source_type: 4, source_id: "doc-fixture", source_name: "Project document" }],
      participants: [participant],
      time_range_start: "", time_range_end: "", total_msg_count: 0,
      created_at: now, updated_at: now, activity_at: now,
      is_unread: false, needs_attention: false,
      has_pending_invitation: false, has_pending_submission: false,
      result: null, error_message: null,
      permissions: {
        can_edit: false, can_schedule: true, can_view_schedule: true,
        can_edit_team: false, can_edit_personal: false,
        can_add_member: false, can_remove_member: false,
      },
    };
    worker.use(
      http.get("*/summary/api/v1/summaries", () => env({ items: [task], total: 1 })),
      http.get(`*/summary/api/v1/summaries/${taskId}`, () => env(task)),
      http.get(`*/summary/api/v1/summaries/${taskId}/personal`, () => env({
        id: 30169, version: 1, worker_status: ready ? 2 : 1,
        content: ready ? "Document result is ready." : "",
        citations: [], msg_count: 0, generated_at: now,
      })),
      // Keep generation state controlled by the personal endpoint; the SSE
      // heartbeat must be mocked too so the fixture never leaks to Vite proxy.
      http.get(`*/summary/api/v1/summaries/${taskId}/stream`, () => HttpResponse.text(
        ": heartbeat\n\n", { headers: { "content-type": "text/event-stream" } }
      )),
      http.get(`*/summary/api/v1/summaries/${taskId}/members`, () => env({
        members: [{ ...participant, status: ready ? "completed" : "processing" }],
      })),
      http.get(`*/summary/api/v1/summaries/${taskId}/personal-versions`, () => env({ versions: [], keep_limit: 3 })),
      http.get(`*/summary/api/v1/summaries/${taskId}/versions`, () => env({ versions: [], keep_limit: 3 })),
      http.post(`*/summary/api/v1/summaries/${taskId}/read`, () => env({ is_unread: false, needs_attention: false })),
      http.post("*/summary/api/v1/summaries/batch-status", () => env({ items: [task] })),
      http.get(`*/summary/api/v1/summary-schedules/${taskId}`, () => env({
        schedule_id: taskId, title: "Legacy document schedule", summary_mode: 2,
        is_active: true, confirm_policy: 1,
        participant_config: { participants: [{ user_id: participant.user_id, confirmed: false }] },
        sources: task.sources, participants: [participant], interval_days: 7,
        interval_months: 0, run_time: "09:00", cron_expr: "", time_range_type: 2,
        created_at: now, updated_at: now,
      })),
      http.get("*/summary/api/v1/summary-templates", () => env({ templates: [], custom_template_limit: 30 }))
    );
  }, options);
}
