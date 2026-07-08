// @octo/runtime — Runtime API（真实 HTTP，对齐 multica REST 契约；本版命中 MSW mock）
import type { RuntimeDevice, RuntimeListParams } from "./types";
import { resolveWorkspaceId } from "./types";
import { httpGet } from "./http";

export function listRuntimes(
  params?: RuntimeListParams,
): Promise<RuntimeDevice[]> {
  return httpGet<RuntimeDevice[]>("/runtimes", {
    workspace_id: resolveWorkspaceId(params?.workspace_id),
    status: params?.status,
    keyword: params?.keyword,
  });
}

export function getRuntime(id: string): Promise<RuntimeDevice> {
  return httpGet<RuntimeDevice>(`/runtimes/${id}`);
}
