import { Thread, ThreadStatus } from "../../Service/Thread";

/** 行内归档按钮要执行的目标动作（由子区当前状态推导） */
export type ArchiveAction = "archive" | "unarchive";

/**
 * 由 thread.status 推导行内按钮点击后应执行的动作。
 * 活跃 → 归档；已归档 → 取消归档；其它状态（如已删除）→ null（不可操作）。
 * 抽成纯函数便于单测，并让活跃组 / 已归档组复用同一行组件时按状态区分图标与 title。
 */
export function deriveArchiveAction(thread: Thread): ArchiveAction | null {
  if (thread.status === ThreadStatus.Active) return "archive";
  if (thread.status === ThreadStatus.Archived) return "unarchive";
  return null;
}

/**
 * 是否渲染行内归档按钮。
 * 需同时满足：有编辑权限（与详情菜单一致，无权限不显示）且能推导出有效动作。
 * 抽成纯函数便于单测。
 */
export function shouldShowArchiveButton(
  thread: Thread,
  canEdit: boolean
): boolean {
  return canEdit && deriveArchiveAction(thread) !== null;
}
