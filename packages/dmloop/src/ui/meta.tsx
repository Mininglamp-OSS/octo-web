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
