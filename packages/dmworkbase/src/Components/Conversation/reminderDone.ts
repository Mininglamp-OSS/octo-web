// Pure decision logic for which conversation reminders should be marked done.
// Extracted from `Conversation.updateReminderDoneIfNeed` so the branching can be
// unit-tested; the component wiring is covered separately in assistantIntent.test.ts.

import { ReminderType } from "wukongimjssdk";

export interface ReminderLike {
  reminderID: number;
  messageSeq: number;
  reminderType: ReminderType;
  done: boolean;
}

export interface SelectDoneRemindersOptions {
  // 用户是否已读到会话最新（#1408 指定的信号：browseToMessageSeq >= lastMessage.messageSeq，
  // 与 vm 的已读语义一致）。注意这是“读到最新”而非“历史消息在视口里”——#1408 明确不再要求
  // 那条 @ 的历史消息当前可见。
  scrolledToBottom: boolean;
  // 该 reminder 对应的消息当前是否在视口内可见。
  isVisible: (reminder: ReminderLike) => boolean;
}

// 返回应被标记为 done 的 reminderID 列表。
// - 已读到最新：把该会话内所有未 done 的 mention（ReminderTypeMentionMe）提醒一律 done，
//   包括被挤出视口、当前不可见的历史 @——这正是 #1408（Fix A）要修的：历史 mention 被滚出
//   视口后角标永久亮着。其它类型（如 ReminderTypeApplyJoinGroup 入群申请）不参与这次兜底，
//   仍只按视口可见性处理，避免跳到最新时静默清掉用户没查看的入群申请。
// - 无论是否读到最新：视口内可见的未 done 提醒都标 done（保持原有行为，对所有类型生效）。
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
    const isMention =
      reminder.reminderType === ReminderType.ReminderTypeMentionMe;
    if ((scrolledToBottom && isMention) || isVisible(reminder)) {
      doneReminderIDs.push(reminder.reminderID);
    }
  }
  return doneReminderIDs;
}
