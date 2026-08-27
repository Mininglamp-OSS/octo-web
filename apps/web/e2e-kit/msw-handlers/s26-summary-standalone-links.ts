import type { Page } from "@playwright/test";

export async function registerS26SummaryStandaloneLinks(page: Page): Promise<void> {
  function install() {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: unknown) => unknown) => unknown;
        post: (path: string, resolver: (info: unknown) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: Msw; __s26MswInstalled?: boolean; __s26MswTimer?: number; __s26MswError?: string };
    const msw = win.__msw;
    if (!msw) {
      if (!win.__s26MswTimer) {
        let attempts = 0;
        win.__s26MswTimer = window.setInterval(() => {
          if (++attempts > 300) {
            window.clearInterval(win.__s26MswTimer);
            win.__s26MswError = "[S26] MSW worker 未在 3 秒内就绪";
          }
          if (install()) window.clearInterval(win.__s26MswTimer);
        }, 10);
      }
      return false;
    }
    if (win.__s26MswInstalled) return true;

    const detail = { code: 0, message: "ok", data: {
      task_id: 2601, task_no: "e2e-task-026", title: "S26 独立总结详情", topic: "S26 独立总结详情", summary_mode: 1, status: 3, trigger_type: 1,
      time_range_start: "2026-08-24T00:00:00Z", time_range_end: "2026-08-25T00:00:00Z", sources: [{ source_type: 1, source_id: "s26-source", source_name: "S26 项目群" }], participants: [],
      result: { content: "## S26 独立详情\n\n这是从任务链接直接打开的总结正文。", abstract: "S26 独立详情摘要", total_msg_count: 8, total_token_used: 100, model_version: "e2e-model", generated_at: "2026-08-25T08:00:00Z", version: 1, citations: [], team_citations: [] },
      error_message: null, creator_id: "e2e-user-1", creator_name: "E2E Tester", origin_channel_id: "s26-source", origin_channel_type: 2, created_at: "2026-08-25T08:00:00Z", updated_at: "2026-08-25T08:05:00Z", result_version: 1, preview: "S26 独立详情摘要", content: "## S26 独立详情\n\n这是从任务链接直接打开的总结正文。",
    } };
    const share = { code: 0, message: "ok", data: { share_id: "e2e-share-026", source_accessible: true, snapshot: {
      id: 2602, task_id: 2601, task_no: "e2e-share-026", space_id: "e2e-space-001", title: "S26 分享总结", source_name: "S26 项目群", source_count: 1, participant_count: 2, message_count: 8, time_range_start: "2026-08-24T00:00:00Z", time_range_end: "2026-08-25T00:00:00Z", summary_mode: 1, result_version: 1, preview: "S26 分享正文", content: "## S26 分享详情\n\n这是从分享链接直接打开的总结正文。", created_at: "2026-08-25T08:00:00Z",
    } } };
    msw.worker.use(
      // `/s` is intentionally malformed and falls through to the regular
      // Summary list route. Keep that bootstrap request inside MSW so the
      // fail-closed proxy check does not mistake it for a backend outage.
      msw.http.get("*/summary/api/v1/summaries", () => msw.HttpResponse.json({ code: 0, message: "ok", data: { items: [], total: 0 } })),
      msw.http.get("*/summary/api/v1/summaries/e2e-task-026", () => msw.HttpResponse.json(detail)),
      msw.http.post("*/summary/api/v1/summaries/2601/read", () => msw.HttpResponse.json({ code: 0, message: "ok", data: { is_unread: false, has_pending_invitation: false, needs_attention: false } })),
      msw.http.get("*/summary/api/v1/summaries/2601/versions", () => msw.HttpResponse.json({ code: 0, message: "ok", data: { versions: [], keep_limit: 3 } })),
      msw.http.get("*/summary/api/v1/summary-shares/e2e-share-026", () => msw.HttpResponse.json(share)),
    );
    win.__s26MswInstalled = true;
    return true;
  }

  await page.addInitScript(install);
  await page.evaluate(install);
}
