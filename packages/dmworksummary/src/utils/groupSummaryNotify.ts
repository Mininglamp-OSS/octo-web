import { Channel } from "wukongimjssdk";
import type { SummaryDetail } from "../types/summary";

const GROUP_CHAT_SOURCE_TYPE = 1;
const STORAGE_KEY_PREFIX = "summary-group-tip:v1:";
const inFlight = new Set<string>();
const sentThisSession = new Set<string>();

export interface GroupSummaryNotifyDeps {
  sendToChannel: (channel: Channel, currentUserId: string) => Promise<void>;
  isDisbanded: (channel: Channel) => boolean;
  warn?: (
    message: string,
    context: { taskId: number; channelId: string; error: unknown }
  ) => void;
}

export function shouldNotifyGroupSummaryCompletion(
  previousStatus: number | undefined,
  detail: Pick<SummaryDetail, "status" | "creator_id">,
  currentUserId: string | undefined,
  completedStatus: number
): boolean {
  return (
    previousStatus !== undefined &&
    previousStatus !== completedStatus &&
    detail.status === completedStatus &&
    !!currentUserId &&
    detail.creator_id === currentUserId
  );
}

export function collectGroupSourceIds(
  sources: SummaryDetail["sources"] | undefined
): string[] {
  const ids = new Set<string>();
  for (const source of sources ?? []) {
    const sourceId = source.source_id?.trim();
    if (source.source_type === GROUP_CHAT_SOURCE_TYPE && sourceId) {
      ids.add(sourceId);
    }
  }
  return [...ids];
}

function storageKey(taskId: number) {
  return `${STORAGE_KEY_PREFIX}${taskId}`;
}

export function readNotifiedGroups(taskId: number): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const value = JSON.parse(localStorage.getItem(storageKey(taskId)) || "[]");
    return Array.isArray(value)
      ? new Set(
          value.filter(
            (item): item is string => typeof item === "string" && !!item
          )
        )
      : new Set();
  } catch {
    return new Set();
  }
}

function markNotified(taskId: number, channelId: string) {
  try {
    if (typeof localStorage === "undefined") return;
    const notified = readNotifiedGroups(taskId);
    notified.add(channelId);
    localStorage.setItem(storageKey(taskId), JSON.stringify([...notified]));
  } catch {
    // Persistence is best-effort. The session set still prevents repeats in
    // this tab, and a future observation may retry after storage recovers.
  }
}

export async function sendGroupSummaryCompletionTips(
  previousStatus: number | undefined,
  detail: SummaryDetail,
  currentUserId: string | undefined,
  completedStatus: number,
  channelTypeGroup: number,
  deps: GroupSummaryNotifyDeps
): Promise<void> {
  if (
    !shouldNotifyGroupSummaryCompletion(
      previousStatus,
      detail,
      currentUserId,
      completedStatus
    )
  )
    return;
  if (!currentUserId) return;

  for (const channelId of collectGroupSourceIds(detail.sources)) {
    const dedupKey = `${detail.task_id}:${channelId}`;
    if (inFlight.has(dedupKey) || sentThisSession.has(dedupKey)) continue;
    if (readNotifiedGroups(detail.task_id).has(channelId)) continue;

    const channel = new Channel(channelId, channelTypeGroup);
    if (deps.isDisbanded(channel)) continue;

    inFlight.add(dedupKey);
    try {
      await deps.sendToChannel(channel, currentUserId);
      sentThisSession.add(dedupKey);
      markNotified(detail.task_id, channelId);
    } catch (error) {
      deps.warn?.("[summaryNotify] send failed", {
        taskId: detail.task_id,
        channelId,
        error,
      });
    } finally {
      inFlight.delete(dedupKey);
    }
  }
}

export function resetGroupSummaryNotifyRuntimeForTests() {
  inFlight.clear();
  sentThisSession.clear();
}
