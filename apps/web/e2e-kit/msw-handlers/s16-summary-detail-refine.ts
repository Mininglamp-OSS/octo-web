/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S16: Summary 详情按意见调整. */
export async function registerS16SummaryDetailRefine(
  page: Page,
  conflict = false
): Promise<void> {
  await page.evaluate(
    ({ conflict }) => {
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
      const env = (data: unknown) =>
        HttpResponse.json({ code: 0, message: "ok", data });
      const taskId = 16016;
      const now = "2026-08-06T16:10:00Z";
      const listItem = {
        task_id: taskId,
        task_no: "S16-TASK-16016",
        title: "S16 可调整总结",
        topic: "S16 可调整总结",
        summary_mode: 1,
        referenceable: true,
        status: 3,
        trigger_type: 1,
        schedule_id: null,
        creator_id: "e2e-user-1",
        time_range_start: "2026-08-05T00:00:00Z",
        time_range_end: "2026-08-06T00:00:00Z",
        sources: [
          {
            source_type: 1,
            source_id: "s16-refine-group",
            source_name: "S16 调整项目群",
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

      const state = {
        targetCalls: 0,
        saves: [] as Array<{ body: any; key: string | null }>,
      };
      (window as any).__s16State__ = state;
      const context = {
        selected_channels: [],
        documents: [],
        participants: [],
        template: null,
        time_range: null,
        referenced_task_ids: [taskId],
      };
      worker.use(
        http.get("*/summary/api/v1/summary-workbench/capabilities", () =>
          env({ enabled: true, contract_version: "2", max_time_range_days: 90 })
        ),
        http.get("*/summary/api/v1/summary-templates", () =>
          env({ templates: [], custom_template_limit: 30 })
        ),
        http.get("*/summary/api/v1/summaries", () =>
          env({ items: [listItem], total: 1 })
        ),
        http.get("*/summary/api/v1/summaries/16016", () => env(detail)),
        http.get("*/summary/api/v1/summaries/16017", () =>
          env({ ...detail, task_id: 16017, trigger_type: 3, title: "S16 独立副本", topic: "S16 独立副本" })
        ),
        http.post("*/summary/api/v1/summaries/:id/read", () =>
          env({ is_unread: false })
        ),
        http.get("*/summary/api/v1/summaries/:id/versions", () =>
          env({ versions: [], keep_limit: 5 })
        ),
        http.get("*/summary/api/v1/summaries/16016/optimization-target", () => {
          state.targetCalls++;
          return env({
            target: {
              task_id: taskId,
              result_kind: "team",
              expected_revision: "s16-original-revision",
            },
            title: listItem.title,
            can_save_version: true,
          });
        }),
        http.get("*/summary/api/v1/agent/chat/history", ({ request }: any) =>
          env({
            contract_version: "2",
            session_id: new URL(request.url).searchParams.get("session_id"),
            messages: [],
            state: {
              scope_version: 1,
              summary_context: context,
              current_preview: null,
              pending_proposal: null,
              workflow: null,
            },
          })
        ),
        http.post(
          "*/summary/api/v1/agent/chat/stream",
          async ({ request }: any) => {
            const input = await request.json();
            const preview = {
              message_id: 160162,
              result_type: "agent_preview",
              scope_version: input.scope_version,
              artifact_version: 1,
              snapshot_version: 1,
              content: "S16 已按意见调整正文",
              assumptions: [],
              available_actions: ["save_preview", "continue_chat"],
            };
            const done = {
              contract_version: "2",
              session_id: input.session_id,
              message_id: preview.message_id,
              result_type: "agent_preview",
              reply: "S16 优化预览已生成",
              scope_version: input.scope_version,
              artifact_version: 1,
              available_actions: ["save_preview", "continue_chat"],
              state: {
                scope_version: input.scope_version,
                summary_context: input.summary_context,
                current_preview: preview,
                pending_proposal: null,
                workflow: null,
              },
            };
            return HttpResponse.text(
              `event: done\ndata: ${JSON.stringify(done)}\n\n`,
              { headers: { "content-type": "text/event-stream" } }
            );
          }
        ),
        http.post(
          "*/summary/api/v1/summaries/agent",
          async ({ request }: any) => {
            const body = await request.json();
            state.saves.push({
              body,
              key: request.headers.get("Idempotency-Key"),
            });
            if (body.save_mode === "new_version" && conflict)
              return HttpResponse.json(
                { code: 40009, message: "summary changed; draft preserved" },
                { status: 409 }
              );
            if (body.save_mode === "new_version") {
              detail.result.content = "S16 已按意见调整正文";
              detail.result.version = 2;
              return env({
                task_id: taskId,
                task_no: listItem.task_no,
                status: 3,
                created_at: now,
                save_mode: "new_version",
                version: 2,
                result_id: 160162,
                result_kind: "team",
              });
            }
            return env({
              task_id: 16017,
              task_no: "S16-COPY",
              status: 3,
              created_at: now,
            });
          }
        )
      );
    },
    { conflict }
  );
}
