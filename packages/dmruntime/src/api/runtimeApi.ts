// @octo/runtime — Runtime API (Mock)
// 本版本全部返回 Mock 数据；结构对齐 loop runtime 域契约，便于后续替换为真实 axios 请求。
import type { RuntimeDevice, RuntimeListParams } from "./types";
import { resolveWorkspaceId } from "./types";
import { MOCK_RUNTIMES } from "./mock/runtimes";

function sleep(ms = 180): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 列表：按 workspace_id 过滤 + 可选 status/keyword。 */
export async function listRuntimes(
  params?: RuntimeListParams,
): Promise<RuntimeDevice[]> {
  await sleep();
  const workspaceId = resolveWorkspaceId(params?.workspace_id);
  let rows = MOCK_RUNTIMES.filter((r) => r.workspace_id === workspaceId);
  if (params?.status) {
    rows = rows.filter((r) => r.status === params.status);
  }
  if (params?.keyword) {
    const kw = params.keyword.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(kw) ||
        r.provider.toLowerCase().includes(kw),
    );
  }
  return rows;
}

/** 详情。 */
export async function getRuntime(id: string): Promise<RuntimeDevice | null> {
  await sleep(120);
  return MOCK_RUNTIMES.find((r) => r.id === id) ?? null;
}
