import { Channel } from "wukongimjssdk";
import { SourceType, type SummaryDetail } from "../types/summary";

const STORAGE_KEY_PREFIX = "summary-group-tip:v1:";
// Storage key keeps the historical "agent" name for backward compatibility
// with in-flight eligibility marks; eligibility itself now covers every
// trigger type (see markAgentSummaryNotificationEligible).
const AGENT_ELIGIBILITY_STORAGE_KEY =
  "summary-group-tip-agent-eligible:v1";
const MAX_AGENT_ELIGIBLE_TASKS = 100;
const AGENT_ELIGIBILITY_TTL_MS = 10 * 60 * 1000;
const inFlight = new Set<string>();
const sentThisSession = new Set<string>();
const consumedAgentEligibilityThisSession = new Set<number>();

interface AgentEligibleTask {
  id: number;
  ts: number;
}

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
  completedStatus: number,
  allowInitialCompletion = false
): boolean {
  return (
    detail.status === completedStatus &&
    !!currentUserId &&
    detail.creator_id === currentUserId &&
    ((previousStatus !== undefined && previousStatus !== completedStatus) ||
      (previousStatus === undefined && allowInitialCompletion))
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
    !detail.sources?.length &&
    detail.origin_channel_type === SourceType.GROUP_CHAT &&
    originChannelId
  ) {
    ids.add(originChannelId);
  }
  return [...ids];
}

function readAgentEligibleTasks(): AgentEligibleTask[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const value = JSON.parse(
      localStorage.getItem(AGENT_ELIGIBILITY_STORAGE_KEY) || "[]"
    );
    if (!Array.isArray(value)) return [];

    const now = Date.now();
    const tasks = value.filter(
      (item): item is AgentEligibleTask =>
        typeof item === "object" &&
        item !== null &&
        Number.isInteger(item.id) &&
        item.id > 0 &&
        Number.isFinite(item.ts) &&
        item.ts <= now &&
        now - item.ts <= AGENT_ELIGIBILITY_TTL_MS
    );
    if (tasks.length !== value.length) {
      localStorage.setItem(
        AGENT_ELIGIBILITY_STORAGE_KEY,
        JSON.stringify(tasks)
      );
    }
    return tasks;
  } catch {
    return [];
  }
}

/**
 * Mark a newly created summary task as eligible for a completion tip even if
 * the page first observes it already COMPLETED (fast completion / refresh /
 * re-open). Covers every trigger type — the eligibility mark is only written
 * at creation time by the creator, so a later page load of an old task can
 * never retroactively post into a shared group.
 */
export function markAgentSummaryNotificationEligible(taskId: number) {
  try {
    if (
      typeof localStorage === "undefined" ||
      !Number.isInteger(taskId) ||
      taskId <= 0
    )
      return;
    const tasks = readAgentEligibleTasks().filter(({ id }) => id !== taskId);
    tasks.push({ id: taskId, ts: Date.now() });
    localStorage.setItem(
      AGENT_ELIGIBILITY_STORAGE_KEY,
      JSON.stringify(tasks.slice(-MAX_AGENT_ELIGIBLE_TASKS))
    );
  } catch {
    // Eligibility is best-effort. Missing it produces an accepted missed tip,
    // never a retroactive post into a shared group.
  }
}

export function isAgentSummaryNotificationEligible(taskId: number): boolean {
  return (
    !consumedAgentEligibilityThisSession.has(taskId) &&
    readAgentEligibleTasks().some(({ id }) => id === taskId)
  );
}

function consumeAgentSummaryNotificationEligibility(taskId: number): boolean {
  if (consumedAgentEligibilityThisSession.has(taskId)) return false;
  const tasks = readAgentEligibleTasks();
  if (!tasks.some(({ id }) => id === taskId)) return false;
  consumedAgentEligibilityThisSession.add(taskId);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        AGENT_ELIGIBILITY_STORAGE_KEY,
        JSON.stringify(tasks.filter(({ id }) => id !== taskId))
      );
    }
  } catch {
    // The in-memory observation still consumes this attempt for the page.
  }
  return true;
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
  const allowInitialCompletion =
    previousStatus === undefined &&
    detail.status === completedStatus &&
    !!currentUserId &&
    detail.creator_id === currentUserId &&
    consumeAgentSummaryNotificationEligibility(detail.task_id);
  if (
    !shouldNotifyGroupSummaryCompletion(
      previousStatus,
      detail,
      currentUserId,
      completedStatus,
      allowInitialCompletion
    )
  )
    return;
  if (previousStatus !== undefined) {
    consumeAgentSummaryNotificationEligibility(detail.task_id);
  }
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
  consumedAgentEligibilityThisSession.clear();
}
