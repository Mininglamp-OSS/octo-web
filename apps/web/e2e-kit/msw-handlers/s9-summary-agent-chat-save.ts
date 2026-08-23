/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S9: Agent 总结 chat → 保存为总结 → 详情. */
export async function registerS9SummaryAgentChatSave(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S9] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });
    const taskId = 9901;
    const now = "2026-08-06T09:10:00Z";
    const title = "S9 Agent 风险总结";
    const source = {
      source_type: 1,
      source_id: "s9-agent-project-group",
      source_name: "S9 Agent 项目群",
    };
    const detail = {
      task_id: taskId,
      task_no: "S9-TASK-9901",
      title,
      topic: title,
      summary_mode: 1,
      status: 3,
      trigger_type: 3,
      schedule_id: null,
      creator_id: "e2e-user-1",
      time_range_start: "2026-08-05T00:00:00Z",
      time_range_end: "2026-08-06T00:00:00Z",
      sources: [source],
      participants: [{ user_id: "e2e-user-1", user_name: "E2E Tester", status: 1, confirmed_at: now }],
      total_msg_count: 18,
      creator_name: "E2E Tester",
      origin_channel_id: "s9-agent-project-group",
      origin_channel_type: 2,
      created_at: now,
      updated_at: "2026-08-06T09:12:30Z",
      completed_at: "2026-08-06T09:12:00Z",
      is_unread: true,
      has_pending_invitation: false,
      has_pending_submission: false,
      needs_attention: false,
      current_result_id: 8901,
      current_personal_version_id: null,
      activity_at: "2026-08-06T09:12:00Z",
      result_id: 8901,
      result_edited_at: null,
      result_is_edited: false,
      error_message: null,
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
        content:
          "## S9 Agent 风险总结\n\n- 风险项需要提前暴露\n- 下周计划按负责人同步\n",
        abstract: "S9 Agent 总结已保存，风险和计划已整理。",
        total_msg_count: 18,
        total_token_used: 1600,
        model_version: "e2e-agent-summary-model",
        version: 1,
        operation_type: "generate",
        operation_note: "",
        parent_result_id: null,
        generated_at: "2026-08-06T09:12:00Z",
        citations: [],
        team_citations: [],
      },
    };

    (window as unknown as { __s9State__: { listCalls: number; streamCalls: number; saveCalls: number; saveBody: unknown } }).__s9State__ = {
      listCalls: 0,
      streamCalls: 0,
      saveCalls: 0,
      saveBody: null,
    };

    worker.use(
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s9State__: { listCalls: number } }).__s9State__;
        state.listCalls += 1;
        return env({ items: [], total: 0, attention_count: 0, unread_count: 0, pending_invitation_count: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/summary-chat-candidates", () =>
        env([{ chat_id: "s9-agent-project-group", chat_type: "group", name: "S9 Agent 项目群", member_count: 2, is_archived: false }])
      ),
      http.post("*/sidebar/sync", () =>
        HttpResponse.json({ items: [], version: 0, follow_version: 0 })
      ),
      http.get("*/summary/api/v1/agent/chat/history", ({ request }: any) => {
        const url = new URL(request.url);
        return env({ session_id: url.searchParams.get("session_id") || "", messages: [] });
      }),
      http.post("*/summary/api/v1/agent/chat/stream", () => {
        const state = (window as unknown as { __s9State__: { streamCalls: number } }).__s9State__;
        state.streamCalls += 1;
        const body = [
          "event: progress",
          'data: {"phase":"understand","step":1,"count":1}',
          "",
          "event: progress",
          'data: {"phase":"compose","step":2,"count":3}',
          "",
          "event: done",
          'data: {"reply":"S9 Agent 已整理项目风险和下周计划","session_id":"s9-agent-session"}',
          "",
        ].join("\n");
        return HttpResponse.text(body, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }),
      http.post("*/summary/api/v1/summaries/agent", async ({ request }: any) => {
        const state = (window as unknown as { __s9State__: { saveCalls: number; saveBody: unknown } }).__s9State__;
        state.saveCalls += 1;
        // 记录请求体供 spec 断言：Agent 保存不得携带 participants（P1 回归）。
        state.saveBody = await request.json();
        return env({
          task_id: taskId,
          task_no: "S9-TASK-9901",
          status: 3,
          created_at: now,
        });
      }),
      http.post("*/summary/api/v1/summaries/agent/finalize", async ({ request }: any) => {
        const state = (window as unknown as { __s9State__: { saveCalls: number; saveBody: unknown } }).__s9State__;
        state.saveCalls += 1;
        // 记录请求体供 spec 断言：Agent 保存不得携带 participants（P1 回归）。
        state.saveBody = await request.json();
        return HttpResponse.json({
          code: 0,
          message: "ok",
          data: {
            task_id: taskId,
            status: 0,
          },
        }, { status: 202 });
      }),
      http.get("*/summary/api/v1/summaries/9901", () => env(detail)),
      http.post("*/summary/api/v1/summaries/9901/read", () =>
        env({ is_unread: false, has_pending_invitation: false, needs_attention: false })
      ),
      http.get("*/summary/api/v1/summaries/9901/versions", () =>
        env({ versions: [], keep_limit: 3 })
      )
    );
  });
}
