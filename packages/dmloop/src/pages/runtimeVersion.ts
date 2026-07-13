import type { RuntimeDevice } from "../api/types";

// runtimeVersion 返回单个 runtime 自己的 agent CLI 版本（如 "2.1.207 (Claude Code)"），
// 优先取 metadata.version，其次从 device_info（"host · <version>"）推导，最后回退 launch_header。
export function runtimeVersion(r: RuntimeDevice): string {
  const version = r.metadata?.["version"];
  if (typeof version === "string" && version.trim()) return version.trim();
  const info = r.device_info || "";
  const parts = info.split("·").map((part) => part.trim()).filter(Boolean);
  return parts.slice(1).join(" · ") || r.launch_header || "-";
}

// deviceVersion 是机器/daemon 级版本——取 daemon 上报的自身 CLI 版本
// （metadata.cli_version，同一台机器的所有 runtime 一致）。
// 不能取某个 agent runtime 的版本：那是 agent 级信息，放在机器头部会误导
// （看起来像整机版本），且与下方该 runtime 行重复。
export function deviceVersion(runtimes: RuntimeDevice[]): string {
  for (const runtime of runtimes) {
    const cliVersion = runtime.metadata?.["cli_version"];
    if (typeof cliVersion === "string" && cliVersion.trim()) return cliVersion.trim();
  }
  return "-";
}
