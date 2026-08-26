/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S12: Agent 保存为总结业务失败后保留对话. */
export async function registerS12SummaryAgentSaveFailure(page: Page): Promise<void> {
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
    if (!msw) throw new Error("[S12] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });

    worker.use(
      http.get("*/summary/api/v1/summaries", () =>
        env({ items: [], total: 0, attention_count: 0, unread_count: 0, pending_invitation_count: 0 })
      ),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      ),
      http.get("*/summary/api/v1/agent/chat/history", ({ request }: any) => {
        const url = new URL(request.url);
        return env({ session_id: url.searchParams.get("session_id") || "", messages: [] });
      }),
      http.post("*/summary/api/v1/agent/chat/stream", () => {
        const body = [
          "event: progress",
          'data: {"phase":"understand","step":1,"count":1}',
          "",
          "event: done",
          'data: {"reply":"S12 Agent 已生成可保存内容","session_id":"s12-agent-session"}',
          "",
        ].join("\n");
        return HttpResponse.text(body, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }),
      http.post("*/summary/api/v1/summaries/agent", () =>
        HttpResponse.json({
          code: 40004,
          message: "当前对话还没有可保存的总结，请先与 AI 对话产出内容",
          data: null,
        })
      )
    );
  });
}
