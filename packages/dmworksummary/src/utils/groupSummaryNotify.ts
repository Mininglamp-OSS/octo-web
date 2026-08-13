import { Channel } from "wukongimjssdk";
import {
  SourceType,
  TriggerType,
  type SummaryDetail,
} from "../types/summary";

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
  detail: Pick<SummaryDetail, "status" | "creator_id" | "trigger_type">,
  currentUserId: string | undefined,
  completedStatus: number
): boolean {
  return (
    detail.status === completedStatus &&
    !!currentUserId &&
    detail.creator_id === currentUserId &&
    ((previousStatus !== undefined && previousStatus !== completedStatus) ||
      (previousStatus === undefined && detail.trigger_type === TriggerType.AGENT))
  );
}

export function collectGroupSourceIds(
  detail: Pick<
    SummaryDetail,
    "sources" | "origin_channel_id" | "origin_channel_type"
  >
): string[] {
  const ids = new Set<string>();
  for (const source of detail.sources ?? []) {
    const sourceId = source.source_id?.trim();
    if (source.source_type === SourceType.GROUP_CHAT && sourceId) {
      ids.add(sourceId);
    }
  }
  const originChannelId = detail.origin_channel_id?.trim();
  if (
    detail.origin_channel_type === SourceType.GROUP_CHAT &&
    originChannelId
  ) {
    ids.add(originChannelId);
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

function unmarkNotified(taskId: number, channelId: string) {
  try {
    if (typeof localStorage === "undefined") return;
    const notified = readNotifiedGroups(taskId);
    notified.delete(channelId);
    localStorage.setItem(storageKey(taskId), JSON.stringify([...notified]));
  } catch {
    // Persistence is best-effort.
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

  for (const channelId of collectGroupSourceIds(detail)) {
    const dedupKey = `${detail.task_id}:${channelId}`;
    if (inFlight.has(dedupKey) || sentThisSession.has(dedupKey)) continue;
    if (readNotifiedGroups(detail.task_id).has(channelId)) continue;

    const channel = new Channel(channelId, channelTypeGroup);
    if (deps.isDisbanded(channel)) continue;

    inFlight.add(dedupKey);
    // Claim before the async send so another tab in this browser profile sees
    // the marker. On failure we roll it back; the agreed best-effort model
    // prefers a rare miss over duplicate tips in the source group.
    markNotified(detail.task_id, channelId);
    try {
      await deps.sendToChannel(channel, currentUserId);
      sentThisSession.add(dedupKey);
    } catch (error) {
      unmarkNotified(detail.task_id, channelId);
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
