// @octo/loop — 运行时/我的 页的 workspace 作用域决策(纯函数,便于单测)。
import type { Workspace } from "./types";

export type WorkspaceSelection =
  | { mode: "workspace"; slug: string; id: string }
  | { mode: "machine" };

// 决定「我的/运行时」页如何取上下文:
// - ≥1 workspace:选当前(或第一个)-> workspace 模式。
// - 0 workspace:machine 模式,页面照常挂载并展示用户的机器级 runtime
//   (daemon 以空 workspace 注册)。不创建任何 workspace,切换器里也不会多出东西。
export function resolveWorkspaceSelection(
  workspaces: Workspace[],
  currentId: string,
): WorkspaceSelection {
  if (!workspaces || workspaces.length === 0) {
    return { mode: "machine" };
  }
  const selected = workspaces.find((w) => w.id === currentId) ?? workspaces[0];
  return { mode: "workspace", slug: selected.slug, id: selected.id };
}

// runtimeListPath 选运行时列表端点:有 workspace slug 用 workspace 作用域的
// /runtimes(强 workspace 组);无 slug(0 workspace / 机器级模式)用 auth-only
// 的 /machine-runtimes —— /runtimes 在此情形会被 workspace 中间件 403。
export function runtimeListPath(slug: string): string {
  return slug ? "/runtimes" : "/machine-runtimes";
}
