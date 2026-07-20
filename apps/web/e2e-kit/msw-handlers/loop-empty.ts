/**
 * loop-empty MSW handlers — 对应 case C1 (回路空 workspace 引导)
 *
 * 复用范围: 任何"进 /loop 但 workspace 为空"的 case 都可以挂这套。
 * 覆盖的 endpoint:
 *   - `common/appconfig` → 强开 dmloop_on
 *   - `fleet/api/v1/workspaces` → []
 *   - `fleet/api/v1/**` 兜底 → []
 */
import { http, HttpResponse } from "msw";

export const loopEmptyHandlers = [
  http.get("*/common/appconfig", () =>
    HttpResponse.json({
      dmloop_on: "1",
      docs_on: "0",
      dmpersonal_on: "0",
      thread_on: false,
      oidc_providers: [],
    })
  ),

  http.get("*/fleet/api/v1/workspaces", () => HttpResponse.json([])),

  // 兜底: 其他 fleet API 一律 [] (未来展开 case 时按需覆盖前面精确路由)
  http.all("*/fleet/api/v1/*", () => HttpResponse.json([])),
  http.all("*/fleet/api/v1/**", () => HttpResponse.json([])),
];
