// Pure decision logic for which conversation reminders should be marked done.
// Extracted from `Conversation.updateReminderDoneIfNeed` so the branching can be
// unit-tested without mounting the whole conversation component / DOM viewport.

export interface ReminderLike {
  reminderID: number;
  messageSeq: number;
  done: boolean;
}

export interface SelectDoneRemindersOptions {
  // 用户是否已浏览到会话最新一条消息（browseToMessageSeq >= lastMessage.messageSeq）。
  scrolledToBottom: boolean;
  // 该 reminder 对应的消息当前是否在视口内可见。仅在未滚到底时使用。
  isVisible: (reminder: ReminderLike) => boolean;
}

// 返回应被标记为 done 的 reminderID 列表。
// - 已滚到底：会话内所有未 done 的 reminder 一律 done（覆盖被挤出视口的历史 mention）。
// - 未滚到底：只把视口内可见的未 done reminder 标 done（保持原有行为）。
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
    if (scrolledToBottom || isVisible(reminder)) {
      doneReminderIDs.push(reminder.reminderID);
    }
  }
  return doneReminderIDs;
}
