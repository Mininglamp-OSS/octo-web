/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/** S2: Summary 空态 → 创建页入口. */
export async function registerS2SummaryEmptyCreateEntry(
  page: Page,
  options: { workbenchEnabled?: boolean } = {}
): Promise<void> {
  await page.evaluate(({ workbenchEnabled }) => {
    type MSW = {
      worker: { use: (...h: unknown[]) => void };
      http: { get: (path: string, resolver: (info: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[S2] MSW worker 未就绪 (等 __MSW_READY__).");
    const { worker, http, HttpResponse } = msw;
    const env = (data: unknown) => HttpResponse.json({ code: 0, message: "ok", data });

    (window as unknown as { __s2State__: { listCalls: number } }).__s2State__ = {
      listCalls: 0,
    };

    worker.use(
      http.get("*/summary/api/v1/summary-workbench/capabilities", () =>
        env({
          enabled: workbenchEnabled,
          contract_version: "1",
          max_time_range_days: 90,
        })
      ),
      http.get("*/summary/api/v1/summaries", () => {
        const state = (window as unknown as { __s2State__: { listCalls: number } }).__s2State__;
        state.listCalls += 1;
        return env({ items: [], total: 0 });
      }),
      http.get("*/summary/api/v1/summary-templates", () =>
        env({ templates: [], custom_template_limit: 30 })
      )
    );
  }, { workbenchEnabled: options.workbenchEnabled ?? false });
}
