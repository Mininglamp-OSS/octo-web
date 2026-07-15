// @octo/loop — Runtime API（后端契约联调；Runtime 已并入 Loop 二级菜单）
import type { RuntimeDevice, ListParams } from "./types";
import { currentWorkspaceSlug, httpGet } from "./http";
import { runtimeListPath } from "./workspaceSelection";

export async function listRuntimes(params?: ListParams): Promise<RuntimeDevice[]> {
  const rows = await httpGet<RuntimeDevice[]>(runtimeListPath(currentWorkspaceSlug()));
  const kw = params?.keyword?.trim().toLowerCase();
  if (!kw) return rows ?? [];
  return (rows ?? []).filter(
    (r) => r.name.toLowerCase().includes(kw) || r.provider.toLowerCase().includes(kw),
  );
}

export function getRuntime(id: string): Promise<RuntimeDevice> {
  return httpGet<RuntimeDevice>(`/runtimes/${id}`);
}
