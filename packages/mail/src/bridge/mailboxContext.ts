import { useEffect, useState } from "react";
import type { AgentMailbox } from "./types";

export interface AgentMailboxContext {
  spaceId: string;
  mailbox: AgentMailbox;
}

type Listener = () => void;
type SwitchGuard = (proceed: () => boolean) => boolean;

let snapshot: AgentMailboxContext | null = null;
const listeners = new Set<Listener>();
const switchGuards = new Set<SwitchGuard>();

const selectionStorageKey = (spaceId: string) =>
  `octo:mail:selected-agent-mailbox:${spaceId || "default"}`;

export function readRememberedAgentMailbox(spaceId: string): string {
  try {
    return window.sessionStorage.getItem(selectionStorageKey(spaceId)) || "";
  } catch {
    return "";
  }
}

function rememberAgentMailbox(spaceId: string, mailboxId: string) {
  try {
    window.sessionStorage.setItem(selectionStorageKey(spaceId), mailboxId);
  } catch {
    // Browser storage is optional; the in-memory context remains authoritative.
  }
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function getAgentMailboxContext(): AgentMailboxContext | null {
  return snapshot;
}

export function subscribeAgentMailboxContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function replaceAgentMailboxContext(
  next: AgentMailboxContext | null
): void {
  if (
    snapshot?.spaceId === next?.spaceId &&
    snapshot?.mailbox.id === next?.mailbox.id &&
    snapshot?.mailbox.address === next?.mailbox.address &&
    snapshot?.mailbox.connectState === next?.mailbox.connectState &&
    snapshot?.mailbox.botId === next?.mailbox.botId &&
    snapshot?.mailbox.agentName === next?.mailbox.agentName &&
    snapshot?.mailbox.outboundMode === next?.mailbox.outboundMode
  ) {
    return;
  }
  snapshot = next;
  emitChange();
}

export function requestAgentMailboxSwitch(
  next: AgentMailboxContext,
  afterSwitch: () => void = () => undefined
): boolean {
  if (
    snapshot?.spaceId === next.spaceId &&
    snapshot.mailbox.id === next.mailbox.id
  ) {
    replaceAgentMailboxContext(next);
    rememberAgentMailbox(next.spaceId, next.mailbox.id);
    // Selecting the already-active mailbox is a metadata refresh, not a
    // workspace navigation. Replacing the pane here would discard an open
    // composer even though the mailbox identity did not change.
    return true;
  }
  return requestMailWorkspaceSwitch(() => {
    replaceAgentMailboxContext(next);
    rememberAgentMailbox(next.spaceId, next.mailbox.id);
    afterSwitch();
  });
}

export function requestMailWorkspaceSwitch(action: () => void): boolean {
  const guards = Array.from(switchGuards);
  const proceed = (index: number): boolean => {
    if (index >= guards.length) {
      action();
      return true;
    }
    return guards[index]!(() => proceed(index + 1));
  };
  return proceed(0);
}

export function registerAgentMailboxSwitchGuard(
  guard: SwitchGuard
): () => void {
  switchGuards.add(guard);
  return () => switchGuards.delete(guard);
}

export function useAgentMailboxContext(): AgentMailboxContext | null {
  const [context, setContext] = useState(getAgentMailboxContext);
  useEffect(() => {
    const sync = () => setContext(getAgentMailboxContext());
    const unsubscribe = subscribeAgentMailboxContext(sync);
    sync();
    return unsubscribe;
  }, []);
  return context;
}

export function resetAgentMailboxContextForTests(): void {
  snapshot = null;
  listeners.clear();
  switchGuards.clear();
}
