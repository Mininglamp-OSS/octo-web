import React from "react";
import {
  Circle,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleCheck,
  CircleAlert,
  CircleX,
  SignalLow,
  SignalMedium,
  SignalHigh,
  TriangleAlert,
  Minus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  IssueStatus,
  IssuePriority,
  ProjectStatus,
  AssigneeType,
} from "../api/types";
import type { LoopTagTone } from "./LoopTag";

/** Semi 调色板色名（仅供 Semi Avatar / 未迁移的 Semi 控件使用）。 */
type TagColor =
  | "grey"
  | "blue"
  | "cyan"
  | "green"
  | "orange"
  | "red"
  | "violet"
  | "purple"
  | "amber"
  | "teal"
  | "light-blue";

// Status values with a `.loop-status-dot[data-status]` rule + a `loop.agentStatus.*` label.
const KNOWN_DOT_STATUSES = new Set(["idle", "working", "offline", "error", "unstable", "archived"]);
/** Clamp a possibly-unknown status to a known one so dots and labels never render a raw value. */
export function normalizeAgentStatus(status?: string): string {
  return status && KNOWN_DOT_STATUSES.has(status) ? status : "offline";
}

/** 依据名称稳定地挑一个 Semi 头像色，避免同一实体每次渲染换色（Agent/Squad 头像共用）。 */
const AVATAR_COLORS = ["violet", "blue", "cyan", "teal", "green", "amber", "orange", "purple", "indigo", "pink"] as const;
export function avatarColor(name: string): (typeof AVATAR_COLORS)[number] {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

export const ISSUE_STATUS_COLOR: Record<IssueStatus, LoopTagTone> = {
  backlog: "grey",
  todo: "blue",
  in_progress: "amber",
  in_review: "violet",
  done: "green",
  blocked: "red",
  cancelled: "grey",
};

// 状态图标 + 语义色（看板列头 / 卡片 / 列表行 / 详情共用；hex 用于内联 icon 上色）。
export const ISSUE_STATUS_ICON: Record<IssueStatus, LucideIcon> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  in_review: CircleDotDashed,
  done: CircleCheck,
  blocked: CircleAlert,
  cancelled: CircleX,
};

export const ISSUE_STATUS_HEX: Record<IssueStatus, string> = {
  backlog: "#8a8f99",
  todo: "#6b7280",
  in_progress: "var(--semi-color-warning, #f5a623)",
  in_review: "#7f3bf5",
  done: "var(--semi-color-success, #23a55a)",
  blocked: "var(--semi-color-danger, #f5222d)",
  cancelled: "#b8bcc8",
};

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

// 优先级图标 + 语义色（信号强度隐喻；urgent 用告警三角）。
export const PRIORITY_ICON: Record<IssuePriority, LucideIcon> = {
  urgent: TriangleAlert,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
  none: Minus,
};

export const PRIORITY_HEX: Record<IssuePriority, string> = {
  urgent: "var(--semi-color-danger, #f5222d)",
  high: "#fc8800",
  medium: "#f5a623",
  low: "#6b93ff",
  none: "#c9cdd4",
};

export const PRIORITY_COLOR: Record<IssuePriority, LoopTagTone> = {
  urgent: "red",
  high: "orange",
  medium: "amber",
  low: "blue",
  none: "grey",
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
];

// 项目状态徽标样式（对标 multica PROJECT_STATUS_CONFIG）：进行中/已完成为实心强调色
// （amber / info-blue，白字，突出「活跃」态）；规划中/已暂停/已取消为中性灰软标签。
// dot 为下拉项前的圆点色（取消用红点区分，与 multica 一致）。
export const PROJECT_STATUS_STYLE: Record<ProjectStatus, { solid: boolean; bg: string; dot: string }> = {
  planned: { solid: false, bg: "", dot: "#8a8f99" },
  in_progress: { solid: true, bg: "var(--semi-color-warning, #f5a623)", dot: "var(--semi-color-warning, #f5a623)" },
  paused: { solid: false, bg: "", dot: "#8a8f99" },
  completed: { solid: true, bg: "var(--semi-color-info, #2f6fed)", dot: "var(--semi-color-info, #2f6fed)" },
  cancelled: { solid: false, bg: "", dot: "var(--semi-color-danger, #f5222d)" },
};

export const ASSIGNEE_TYPE_COLOR: Record<AssigneeType, TagColor> = {
  member: "blue",
  agent: "violet",
  squad: "purple",
};

// run 状态点颜色（执行记录行的状态圆点；未知值走灰兜底）。
export const RUN_STATUS_HEX: Record<string, string> = {
  queued: "#b8bcc8",
  dispatched: "var(--semi-color-info, #2f6fed)",
  waiting_local_directory: "var(--semi-color-info, #2f6fed)",
  running: "var(--semi-color-warning, #f5a623)",
  completed: "var(--semi-color-success, #35824a)",
  failed: "var(--semi-color-danger, #f5222d)",
  cancelled: "#b8bcc8",
};
export const RUN_STATUS_HEX_FALLBACK = "#c9cdd4";

// Autopilot 运行状态 → 状态点颜色（卡片 last-run 点与详情运行行共用；未知值走灰兜底）。
export const AUTOPILOT_RUN_DOT: Record<string, string> = {
  issue_created: "var(--semi-color-success, #23a55a)",
  completed: "var(--semi-color-success, #23a55a)",
  running: "var(--semi-color-warning, #f5a623)",
  failed: "var(--semi-color-danger, #f5222d)",
  skipped: "var(--semi-color-tertiary, #8a8f99)",
};
export const AUTOPILOT_RUN_DOT_FALLBACK = "#c9cdd4";

// run 是否处于活跃(未结束)态——可终止/仍在产生消息。单一来源,供运行面板与执行详情共用。
const ACTIVE_RUN_STATUSES = ["queued", "dispatched", "waiting_local_directory", "running"];
export function isActiveRun(status: string): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

// run 是否处于终结态——已产生结果,进入履历统计。与 isActiveRun 同为状态生命周期的单一来源。
const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"];
export function isTerminalRun(status: string): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

// 日期展示辅助(列表/看板/详情共用):短格式 M/D,以及是否逾期(未完成且已过截止)。
export function formatShortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function isOverdue(due: string | null | undefined, status: IssueStatus): boolean {
  if (!due || status === "done" || status === "cancelled") return false;
  return new Date(due).getTime() < Date.now();
}
