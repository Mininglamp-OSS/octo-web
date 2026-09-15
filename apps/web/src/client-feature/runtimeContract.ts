export interface RuntimeScope {
  ownerId: string;
  contextId: string;
  epoch: number;
}

export interface OwnerRuntimeBootstrap extends RuntimeScope {
  version: 1;
  summaryAttention: "owner" | "disabled";
}

export interface SummaryRuntimeBootstrap {
  version: 1;
  contextId: string;
  epoch: number;
  summaryAttention: "external" | "local";
}

export type RuntimeBadge =
  | { status: "loading" | "unavailable"; count: null }
  | { status: "ready" | "stale"; count: number };

export interface RuntimeSnapshot extends RuntimeScope {
  version: 1;
  revision: number;
  phase: "starting" | "ready" | "offline" | "recovering" | "failed";
  badges: { messages: RuntimeBadge; summary: RuntimeBadge };
}

export interface RuntimeActivity {
  applicationActive: boolean;
  windowVisible: boolean;
  windowFocused: boolean;
  communicationSurfaceVisible: boolean;
}

export interface RuntimeReady extends RuntimeScope {
  version: 1;
  backgroundRuntimeVersion: 1;
  summaryAttentionProviderVersion?: 1;
}

export interface RuntimeTimer extends RuntimeScope {
  version: 1;
  task: "summaryAttentionRefresh";
  timerId: number;
}

export interface RuntimeCommandResult extends RuntimeScope {
  version: 1;
  requestId: string;
  accepted: boolean;
}

export type RuntimeCommand = RuntimeScope & { version: 1 } & (
  | { type: "activity"; activity: RuntimeActivity }
  | { type: "refresh" }
  | { type: "invalidateSummary"; requestId: string; reason: "mutation" | "manual-refresh" }
  | { type: "dispose" }
  | { type: "timerFired"; task: RuntimeTimer["task"]; timerId: number }
  | { type: "navigate"; page: CommunicationPage; presentation?: CommunicationPresentation; target?: ConversationTarget; navigationId?: number }
  | { type: "spaceChanged"; next: {
      contextId: string;
      epoch: number;
      space: { id: string; name: string };
    } }
);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid runtime object");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected runtime field");
}

function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error("Invalid runtime identifier");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid runtime number");
  return value;
}

function scope(value: Record<string, unknown>): RuntimeScope {
  return { ownerId: id(value.ownerId), contextId: id(value.contextId), epoch: integer(value.epoch) };
}

export function sameRuntimeScope(a: RuntimeScope, b: RuntimeScope): boolean {
  return a.ownerId === b.ownerId && a.contextId === b.contextId && a.epoch === b.epoch;
}

export function parseOwnerRuntimeBootstrap(value: unknown): OwnerRuntimeBootstrap {
  const input = record(value);
  keys(input, ["version", "ownerId", "contextId", "epoch", "summaryAttention"]);
  if (input.version !== 1 || (input.summaryAttention !== "owner" && input.summaryAttention !== "disabled")) {
    throw new Error("Unsupported owner runtime");
  }
  return { version: 1, ...scope(input), summaryAttention: input.summaryAttention as "owner" | "disabled" };
}

export function parseSummaryRuntimeBootstrap(value: unknown): SummaryRuntimeBootstrap {
  const input = record(value);
  keys(input, ["version", "contextId", "epoch", "summaryAttention"]);
  if (input.version !== 1 || (input.summaryAttention !== "external" && input.summaryAttention !== "local")) {
    throw new Error("Unsupported summary runtime");
  }
  return {
    version: 1, contextId: id(input.contextId), epoch: integer(input.epoch),
    summaryAttention: input.summaryAttention as "external" | "local",
  };
}

function badge(value: unknown): RuntimeBadge {
  const input = record(value);
  keys(input, ["status", "count"]);
  if (input.status === "loading" || input.status === "unavailable") {
    if (input.count !== null) throw new Error("Unknown runtime badge must not claim a count");
    return { status: input.status, count: null };
  }
  if (input.status !== "ready" && input.status !== "stale") throw new Error("Invalid runtime badge status");
  return { status: input.status, count: integer(input.count) };
}

export function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  const input = record(value);
  keys(input, ["version", "ownerId", "contextId", "epoch", "revision", "phase", "badges"]);
  if (input.version !== 1 || typeof input.phase !== "string" ||
      !["starting", "ready", "offline", "recovering", "failed"].includes(input.phase)) {
    throw new Error("Invalid runtime snapshot");
  }
  const badges = record(input.badges);
  keys(badges, ["messages", "summary"]);
  return {
    version: 1, ...scope(input), revision: integer(input.revision),
    phase: input.phase as RuntimeSnapshot["phase"],
    badges: { messages: badge(badges.messages), summary: badge(badges.summary) },
  };
}

export function parseRuntimeCommand(value: unknown): RuntimeCommand {
  const input = record(value);
  if (input.version !== 1) throw new Error("Unsupported runtime command");
  const common = { version: 1 as const, ...scope(input) };
  const baseKeys = ["version", "ownerId", "contextId", "epoch", "type"];
  if (input.type === "invalidateSummary") {
    keys(input, [...baseKeys, "requestId", "reason"]);
    if (input.reason !== "mutation" && input.reason !== "manual-refresh") throw new Error("Invalid refresh reason");
    return { ...common, type: input.type, requestId: id(input.requestId), reason: input.reason };
  }
  if (input.type === "refresh" || input.type === "dispose") {
    keys(input, baseKeys);
    return { ...common, type: input.type };
  }
  if (input.type === "timerFired") {
    keys(input, [...baseKeys, "task", "timerId"]);
    if (input.task !== "summaryAttentionRefresh") throw new Error("Unknown runtime task");
    return { ...common, type: "timerFired", task: input.task, timerId: integer(input.timerId) };
  }
  if (input.type === "navigate") {
    keys(input, [...baseKeys, "page", "presentation", "target", "navigationId"]);
    if (input.page !== "chat" && input.page !== "contacts") throw new Error("Invalid runtime page");
    if (input.presentation !== undefined && input.presentation !== "workspace" && input.presentation !== "conversation") {
      throw new Error("Invalid runtime presentation");
    }
    const target = input.target === undefined ? undefined : parseConversationTarget(input.target);
    const navigationId = input.navigationId === undefined ? undefined : (() => {
      const n = integer(input.navigationId);
      if (n < 1) throw new Error("Navigation ID must be a positive safe integer");
      return n;
    })();
    if (target && input.page !== "chat") throw new Error("Conversation target requires chat");
    if (target?.variant === "app-bot" && input.presentation !== "conversation") throw new Error("App conversation requires conversation presentation");
    if (target?.variant === "workspace-group" && input.presentation !== "workspace") throw new Error("Workspace-group requires workspace presentation");
    return {
      ...common, type: "navigate",
      page: input.page, presentation: input.presentation as CommunicationPresentation | undefined,
      target, navigationId,
    };
  }
  if (input.type === "activity") {
    keys(input, [...baseKeys, "activity"]);
    const activity = record(input.activity);
    const activityKeys = ["applicationActive", "windowVisible", "windowFocused", "communicationSurfaceVisible"];
    keys(activity, activityKeys);
    if (activityKeys.some((key) => typeof activity[key] !== "boolean")) throw new Error("Invalid runtime activity");
    return { ...common, type: "activity", activity: activity as unknown as RuntimeActivity };
  }
  if (input.type === "spaceChanged") {
    keys(input, [...baseKeys, "next"]);
    const next = record(input.next);
    keys(next, ["contextId", "epoch", "space"]);
    const space = record(next.space);
    keys(space, ["id", "name"]);
    if (typeof space.name !== "string" || space.name.length > 1024) throw new Error("Invalid runtime space");
    return { ...common, type: "spaceChanged", next: {
      contextId: id(next.contextId), epoch: integer(next.epoch),
      space: { id: id(space.id), name: space.name },
    } };
  }
  throw new Error("Unknown runtime command");
}

function parseConversationTarget(value: unknown): ConversationTarget {
  const input = record(value);
  keys(input, ["channelId", "channelType", "messageSeq", "openChannelSearch", "displayName", "avatar", "metadata", "variant"]);
  if (typeof input.channelId !== "string" || !input.channelId.trim() || input.channelId.trim().length > 512) {
    throw new Error("Invalid conversation identifier");
  }
  const target: ConversationTarget = { channelId: input.channelId.trim(), channelType: integer(input.channelType) };
  if (input.messageSeq !== undefined) target.messageSeq = integer(input.messageSeq);
  if (input.openChannelSearch !== undefined) {
    if (typeof input.openChannelSearch !== "boolean") throw new Error("Invalid channel search");
    target.openChannelSearch = input.openChannelSearch;
  }
  for (const key of ["displayName", "avatar"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || input[key].length > (key === "avatar" ? 8192 : 512)) throw new Error("Invalid target text");
      target[key] = input[key];
    }
  }
  if (input.metadata !== undefined) {
    const metadata = record(input.metadata);
    const encoded = JSON.stringify(metadata);
    if (!encoded || encoded.length > 64 * 1024) throw new Error("Invalid target metadata");
    target.metadata = metadata;
  }
  if (input.variant !== undefined) {
    if (input.variant === "app-bot" && target.channelType !== 1) throw new Error("App-bot variant requires channelType 1");
    if (input.variant === "workspace-group" && target.channelType !== 2) {
      throw new Error("Workspace-group variant requires channelType 2");
    }
    if (input.variant !== "app-bot" && input.variant !== "workspace-group") throw new Error("Invalid target variant");
    target.variant = input.variant;
  }
  return target;
}
import type { ConversationTarget, CommunicationPage, CommunicationPresentation } from "../client-communication/hostBridge";
