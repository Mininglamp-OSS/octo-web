// @octo/loop — Runtime API（后端契约联调；Runtime 已并入 Loop 二级菜单）
import type { RuntimeDevice, ListParams } from "./types";
import { currentWorkspaceSlug, httpGet, httpPatch } from "./http";
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

// Rename the machine hosting this runtime: applies the name (empty clears it,
// reverting to the daemon-proposed device name) to every runtime the caller
// owns on the same daemon.
export function renameMachine(runtimeId: string, customName: string): Promise<RuntimeDevice> {
  return httpPatch<RuntimeDevice>(`/runtimes/${runtimeId}`, {
    custom_name: customName,
    apply_to_machine: true,
  });
}
