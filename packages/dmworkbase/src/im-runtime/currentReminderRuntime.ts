import WKSDK from "wukongimjssdk";

import {
  syncImReminders,
  type ImReminderRuntimeSdk,
} from "./reminderRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImReminderRuntime() {
  return currentImRuntime() as unknown as ImReminderRuntimeSdk;
}

export function syncCurrentImReminders() {
  syncImReminders(currentImReminderRuntime());
}
