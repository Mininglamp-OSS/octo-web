// @octo/runtime — MSW handlers（Mock 命中真实网络请求）。由宿主传入 startLoopMock。
import { http, HttpResponse, delay } from "msw";
import type { RequestHandler } from "msw";
import { LOOP_API_BASE } from "../http";
import { MOCK_RUNTIMES } from "./runtimes";

const B = LOOP_API_BASE;

export const runtimeHandlers: RequestHandler[] = [
  http.get(`${B}/runtimes`, async ({ request }) => {
    await delay(130);
    const url = new URL(request.url);
    const ws = url.searchParams.get("workspace_id");
    const status = url.searchParams.get("status");
    const kw = url.searchParams.get("keyword")?.trim().toLowerCase();
    let rows = MOCK_RUNTIMES.filter((r) => !ws || r.workspace_id === ws);
    if (status) rows = rows.filter((r) => r.status === status);
    if (kw)
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          r.provider.toLowerCase().includes(kw),
      );
    return HttpResponse.json(rows);
  }),
  http.get(`${B}/runtimes/:id`, async ({ params }) => {
    await delay(90);
    const row = MOCK_RUNTIMES.find((r) => r.id === params.id);
    return row ? HttpResponse.json(row) : new HttpResponse(null, { status: 404 });
  }),
];
