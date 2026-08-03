export interface ImReminderRuntimeSdk {
  reminderManager: {
    sync: () => void;
  };
}

export function syncImReminders(sdk: ImReminderRuntimeSdk) {
  sdk.reminderManager.sync();
}
