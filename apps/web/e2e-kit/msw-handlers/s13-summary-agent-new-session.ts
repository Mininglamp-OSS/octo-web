/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S13: Agent 新会话清空消息与引用. */
export async function registerS13SummaryAgentNewSession(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S13] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 13013;
    const now = "2026-08-06T13:10:00Z";
    const listItem = {
      task_id: taskId,
      task_no: "S13-TASK-13013",
      title: "S13 可引用总结",
      topic: "S13 可引用总结",
      summary_mode: 1,
      status: 3,
      trigger_type: 3,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [{ source_type: 1, source_id: "s13-ref-group", source_name: "S13 引用群" }],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 10,
      creator_name: "E2E Tester",
      origin_channel_id: "s13-ref-group",
      origin_channel_type: 2,
      created_at: now,
      completed_at: "2026-08-06T13:12:00Z",
      is_unread: false,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 130131,
      current_personal_version_id: null,
      activity_at: "2026-08-06T13:12:00Z",
      referenceable: true,
    };
    const detail = {
      ...listItem,
      result_id: 130131,
      updated_at: "2026-08-06T13:12:30Z",
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
        content: "## S13 可引用总结\n\n- S13 引用正文\n",
        abstract: "S13 可引用摘要。",
        total_msg_count: 10,
        total_token_used: 900,
        model_version: "e2e-agent-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T13:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    worker.use(
      http.get("*/summary/api/v1/summary-workbench/capabilities", () =>
        env({
          enabled: true,
          contract_version: "2",
          max_time_range_days: 90,
        })
      ),
      http.get("*/summary/api/v1/summaries", ({ request }: any) => {
        const url = new URL(request.url);
        // Discriminate picker vs list-page: picker sends status=3 (COMPLETED).
        const status = url.searchParams.get("status");
        const isReferencePicker = status === "3";
        return env({
          items: isReferencePicker ? [listItem] : [],
          total: isReferencePicker ? 1 : 0,
          attention_count: 0,
          unread_count: 0,
          pending_invitation_count: 0,
        });
      }),
      http.get("*/summary/api/v1/summary-templates", () => env({ templates: [], custom_template_limit: 30 })),
      http.get("*/summary/api/v1/agent/chat/history", ({ request }: any) => {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("session_id") || "";
        if (sessionId !== "s13-agent-session") {
          return env({ session_id: sessionId, messages: [] });
        }
        return env({
          contract_version: "2",
          session_id: sessionId,
          messages: [
            {
              id: 1,
              role: "user",
              content: "S13 第一轮问题",
              scope_version: 1,
            },
            {
              id: 2,
              role: "assistant",
              content: "S13 Agent 已生成第一轮回复",
              scope_version: 1,
            },
          ],
          state: {
            scope_version: 1,
            summary_context: {
              selected_channels: [],
              documents: [],
              participants: [],
              template: null,
              time_range: null,
              referenced_task_ids: [taskId],
            },
            current_preview: null,
            pending_proposal: null,
            workflow: null,
          },
        });
      }),
      http.get("*/summary/api/v1/summaries/13013", () => env(detail)),
      http.post("*/summary/api/v1/agent/chat/stream", () => {
        const done = {
          contract_version: "2",
          session_id: "s13-agent-session",
          message_id: 2,
          result_type: "explanation",
          reply: "S13 Agent 已生成第一轮回复",
          scope_version: 1,
          available_actions: ["continue_chat"],
          state: {
            scope_version: 1,
            summary_context: {
              selected_channels: [],
              documents: [],
              participants: [],
              template: null,
              time_range: null,
              referenced_task_ids: [taskId],
            },
            current_preview: null,
            pending_proposal: null,
            workflow: null,
          },
        };
        const body = [
          "event: progress",
          'data: {"phase":"understand","step":1,"count":1}',
          "",
          "event: done",
          `data: ${JSON.stringify(done)}`,
          "",
        ].join("\n");
        return HttpResponse.text(body, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      })
    );
  });
}
