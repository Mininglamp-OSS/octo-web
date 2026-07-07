// @octo/runtime — Loop Runtime (device) panel types
// 对齐 loop runtime 域契约；预留 space_id → workspace_id 解析口子。

export type RuntimeMode = "local" | "cloud";
export type RuntimeStatus = "online" | "offline";
export type RuntimeVisibility = "private" | "public";

export interface RuntimeDevice {
  id: string;
  workspace_id: string;
  name: string;
  runtime_mode: RuntimeMode;
  provider: string;
  status: RuntimeStatus;
  device_info: string;
  owner_id: string | null;
  owner_name: string | null;
  visibility: RuntimeVisibility;
  last_seen_at: string | null;
  created_at: string;
  /** 30 天运行任务数（展示用） */
  runs_30d: number;
}

export interface RuntimeListParams {
  workspace_id?: string;
  status?: RuntimeStatus;
  keyword?: string;
}

/**
 * space_id → workspace_id 解析入口。
 * 基础版本直接透传；后续接真实链路时在此把 space_id 映射为 workspace_id。
 */
const DEFAULT_WORKSPACE_ID = "ws-loop-demo";

export function resolveWorkspaceId(spaceId?: string): string {
  return spaceId && spaceId.trim() ? spaceId : DEFAULT_WORKSPACE_ID;
}
