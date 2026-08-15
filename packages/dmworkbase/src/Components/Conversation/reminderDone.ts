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

export interface SelectDoneRemindersOptions {
  // 用户是否已浏览到会话最新一条消息（browseToMessageSeq >= lastMessage.messageSeq）。
  scrolledToBottom: boolean;
  // 该 reminder 对应的消息当前是否在视口内可见。
  isVisible: (reminder: ReminderLike) => boolean;
}

// 返回应被标记为 done 的 reminderID 列表。
// - 已滚到底：只把 mention（ReminderTypeMentionMe）提醒一律 done，覆盖被挤出视口的历史 @。
//   其它类型（如 ReminderTypeApplyJoinGroup 入群申请）不受此兜底影响，避免跳到最新时
//   静默清掉用户尚未查看的入群申请提醒。
// - 无论是否滚到底：视口内可见的未 done 提醒都标 done（保持原有行为，对所有类型生效）。
export function selectDoneReminderIDs(
  reminders: ReminderLike[] | undefined,
  { scrolledToBottom, isVisible }: SelectDoneRemindersOptions
): number[] {
  if (!reminders || reminders.length === 0) {
    return [];
  }
  const doneReminderIDs: number[] = [];
  for (const reminder of reminders) {
    if (reminder.done) {
      continue;
    }
    const isMention = reminder.reminderType === ReminderType.ReminderTypeMentionMe;
    if ((scrolledToBottom && isMention) || isVisible(reminder)) {
      doneReminderIDs.push(reminder.reminderID);
    }
  }
  return doneReminderIDs;
}
