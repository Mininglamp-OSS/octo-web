import { isWorkspaceGroupDisplayName, isWorkspaceGroupDisplayText } from "./presentation";

export interface WorkspaceGroupTarget {
  channelId: string;
  channelType: 2;
}

export interface WorkspaceGroupAction extends WorkspaceGroupTarget {
  projectId: string;
  /** Display only; the host must verify the recorded actor before using this. */
  presentation?: { linkedBy: string; linkedByName: string };
}

export interface WorkspaceGroupContext extends WorkspaceGroupAction {
  projectName: string;
  groupName: string;
  linkedBy?: string;
  linkedByName: string;
  linkedAt?: string;
  manageDisabledReason?: "workspace_membership" | "group_role" | "system_group" | "denied" | "unavailable";
  source: "created_in_project" | "linked_existing" | "unknown";
  canOpen: boolean;
  canManage: boolean;
  isAllMemberGroup: boolean;
}

export interface WorkspaceGroupHost {
  getContext(target: WorkspaceGroupTarget, signal?: AbortSignal): Promise<WorkspaceGroupContext | null>;
  open(target: WorkspaceGroupAction): Promise<void>;
  manage(target: WorkspaceGroupAction): Promise<void>;
  /** A null target invalidates the whole authenticated host scope. */
  subscribe(listener: (target: WorkspaceGroupTarget | null) => void): () => void;
}

/** An unavailable read is not evidence that the group has no workspace. */
export class WorkspaceGroupReadUnavailable extends Error {
  constructor(readonly reason: "inactive" | "session" | "scope") {
    super(`Workspace group read unavailable: ${reason}`);
    this.name = "WorkspaceGroupReadUnavailable";
  }
}

export function isWorkspaceGroupContext(
  value: unknown, target: WorkspaceGroupTarget,
): value is WorkspaceGroupContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return context.channelId === target.channelId && context.channelType === 2
    && typeof context.projectId === "string" && Boolean(context.projectId.trim())
    && isWorkspaceGroupDisplayText(context.projectName) && Boolean(context.projectName.trim())
    && isWorkspaceGroupDisplayText(context.groupName)
    && (context.linkedBy === undefined || (typeof context.linkedBy === "string"
      && context.linkedBy.length <= 256 && !/[^\x21-\x7e]/.test(context.linkedBy)))
    && isWorkspaceGroupDisplayName(context.linkedByName)
    && (context.linkedAt === undefined || typeof context.linkedAt === "string")
    && (context.manageDisabledReason === undefined
      || ["workspace_membership", "group_role", "system_group", "denied", "unavailable"].includes(String(context.manageDisabledReason)))
    && ["created_in_project", "linked_existing", "unknown"].includes(String(context.source))
    && typeof context.canOpen === "boolean" && typeof context.canManage === "boolean"
    && typeof context.isAllMemberGroup === "boolean";
}
