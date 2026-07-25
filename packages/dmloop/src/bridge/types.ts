import type React from "react";
import type { Workspace } from "../api/types";

export type LoopTabKey =
  | "myloop"
  | "issue"
  | "project"
  | "automation"
  | "agent"
  | "squad"
  | "settings";

export interface LoopTabItem {
  key: LoopTabKey;
  icon: React.ReactNode;
  label: string;
}

export interface LoopWorkspaceRenderHelpers {
  reloadWorkspaces: () => Promise<Workspace[]>;
}

export interface LoopIssueDetailRenderHelpers extends LoopWorkspaceRenderHelpers {
  onIssueChanged: () => void;
  onClose: () => boolean | void;
}
