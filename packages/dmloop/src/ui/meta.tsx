import React from "react";
import type {
  IssueStatus,
  IssuePriority,
  ProjectStatus,
  AgentStatus,
  AssigneeType,
} from "../api/types";

/** Semi Tag color 名（受限于 Semi 调色板）。 */
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

export const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

export const ISSUE_STATUS_COLOR: Record<IssueStatus, TagColor> = {
  backlog: "grey",
  todo: "blue",
  in_progress: "amber",
  in_review: "violet",
  done: "green",
  blocked: "red",
  cancelled: "grey",
};

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const PRIORITY_COLOR: Record<IssuePriority, TagColor> = {
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

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, TagColor> = {
  planned: "blue",
  in_progress: "amber",
  paused: "grey",
  completed: "green",
  cancelled: "grey",
};

export const AGENT_STATUS_COLOR: Record<AgentStatus, TagColor> = {
  idle: "grey",
  working: "green",
  offline: "grey",
  error: "red",
};

export const ASSIGNEE_TYPE_COLOR: Record<AssigneeType, TagColor> = {
  member: "blue",
  agent: "violet",
  squad: "purple",
};

export const RUN_STATUS_COLOR: Record<string, TagColor> = {
  queued: "grey",
  dispatched: "blue",
  waiting_local_directory: "blue",
  running: "amber",
  completed: "green",
  failed: "red",
  cancelled: "grey",
};

// run 是否处于活跃(未结束)态——可终止/仍在产生消息。单一来源,供运行面板与执行详情共用。
const ACTIVE_RUN_STATUSES = ["queued", "dispatched", "waiting_local_directory", "running"];
export function isActiveRun(status: string): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
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
