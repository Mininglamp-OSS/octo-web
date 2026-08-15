// Pure decision logic for which conversation reminders should be marked done.
// Extracted from `Conversation.updateReminderDoneIfNeed` so the branching can be
// unit-tested without mounting the whole conversation component / DOM viewport.

import { ReminderType } from "wukongimjssdk";

export interface ReminderLike {
  reminderID: number;
  messageSeq: number;
  reminderType: ReminderType;
  done: boolean;
}

export interface ReadToLatestParams {
  // 会话最后一条消息的 messageSeq。
  lastMessageSeq: number | undefined;
  // 视口内当前真实渲染、可见的最后一条消息的 messageSeq。
  lastVisibleSeq: number | undefined;
  // 是否还有更早的历史消息待上拉加载。
  pullupHasMore: boolean;
}

// 判断用户是否真的“已读到会话最新”——用于把被挤出视口的历史 mention 兜底标 done。
//
// 不能只看 `browseToMessageSeq >= lastMessage.messageSeq`：用户自己发最后一条消息时，
// self-send 快捷路径（vm.ts refreshNewMsgCount）会把 browseToMessageSeq 直接推进到最新
// seq，即使更早的历史根本没加载/没看过。单靠它会把用户没看见的 @ 提醒静默标 done。
//
// 这里改用真实的渲染/加载状态：
//   1. 没有更早历史待加载（!pullupHasMore）——否则未加载区里可能藏着没看过的 @；
//   2. 会话最后一条消息当前真实渲染在视口内（lastVisibleSeq >= lastMessageSeq）。
export function isReadToLatest({
  lastMessageSeq,
  lastVisibleSeq,
  pullupHasMore,
}: ReadToLatestParams): boolean {
  if (pullupHasMore) {
    return false;
  }
  if (typeof lastMessageSeq !== "number") {
    return false;
  }
  if (typeof lastVisibleSeq !== "number") {
    return false;
  }
  return lastVisibleSeq >= lastMessageSeq;
}

export interface SelectDoneRemindersOptions {
  // 用户是否已真实读到会话最新（见 isReadToLatest）。
  readToLatest: boolean;
  // 该 reminder 对应的消息当前是否在视口内可见。
  isVisible: (reminder: ReminderLike) => boolean;
}

// 返回应被标记为 done 的 reminderID 列表。
// - 已读到最新：只把 mention（ReminderTypeMentionMe）提醒一律 done，覆盖被挤出视口的历史 @。
//   其它类型（如 ReminderTypeApplyJoinGroup 入群申请）不受此兜底影响，避免跳到最新时
//   静默清掉用户尚未查看的入群申请提醒。
// - 无论是否读到最新：视口内可见的未 done 提醒都标 done（保持原有行为，对所有类型生效）。
export function selectDoneReminderIDs(
  reminders: ReminderLike[] | undefined,
  { readToLatest, isVisible }: SelectDoneRemindersOptions
): number[] {
  if (!reminders || reminders.length === 0) {
    return [];
  }
  const doneReminderIDs: number[] = [];
  for (const reminder of reminders) {
    if (reminder.done) {
      continue;
    }
    const isMention =
      reminder.reminderType === ReminderType.ReminderTypeMentionMe;
    if ((readToLatest && isMention) || isVisible(reminder)) {
      doneReminderIDs.push(reminder.reminderID);
    }
  }
  return doneReminderIDs;
}
