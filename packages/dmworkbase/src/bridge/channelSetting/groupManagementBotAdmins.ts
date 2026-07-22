// 批量添加 Bot 管理员的提交逻辑，单独抽出便于单测。
//
// 背景：后端只有单 uid 端点 `PUT /:group_no/bot_admin/:uid`，无批量端点。
// 「添加 Bot 管理员」对话框是真多选，因此对每个选中 uid 各发一次 PUT，
// 用 Promise.allSettled 收集结果，部分失败时明确返回失败 uid 列表，
// 不静默吞掉（旧实现只取 selectedItems[0] 提交一个）。
export interface BotAdminSubmitResult {
  // 成功提交的 uid（按输入顺序）
  succeeded: string[];
  // 失败的 uid 及其原因（按输入顺序）
  failed: { uid: string; reason: unknown }[];
}

// 对每个 uid 调一次 setBotAdmin，并发提交、独立收集成败。
// setBotAdmin 已柯里化为只接收 uid，channel 由调用方闭包注入，
// 这样本函数与具体 DataSource / channel 解耦，纯逻辑可测。
export async function submitBotAdmins(
  uids: string[],
  setBotAdmin: (uid: string) => Promise<void>
): Promise<BotAdminSubmitResult> {
  const results = await Promise.allSettled(
    uids.map((uid) => setBotAdmin(uid))
  );
  const succeeded: string[] = [];
  const failed: { uid: string; reason: unknown }[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      succeeded.push(uids[index]);
    } else {
      failed.push({ uid: uids[index], reason: result.reason });
    }
  });
  return { succeeded, failed };
}
