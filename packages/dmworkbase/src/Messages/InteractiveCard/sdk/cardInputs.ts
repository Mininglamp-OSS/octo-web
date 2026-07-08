import type { AdaptiveCard } from "adaptivecards";

/**
 * 卡片输入收集与客户端预校验（octo/v2 交互闭环）。
 *
 * 服务端对 inputs 是权威 fail-closed 校验源，这里做的是**提交前即时反馈**，减少无谓往返。
 * 契约边界：inputs 键必须是生效帧声明的 Input.* id、值为字符串、单字段 ≤ 4KiB、总量 ≤ 16KiB。
 */

const MAX_FIELD_BYTES = 4096; // 单字段 ≤ 4KiB（覆盖 Input.Text）
const MAX_TOTAL_BYTES = 16384; // 总量 ≤ 16KiB

/** 从 SDK 卡片收集声明的 Input.* 值（id → 字符串）。SDK 的 getAllInputs 只含卡内声明的输入。 */
export function collectCardInputs(card: AdaptiveCard): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of card.getAllInputs()) {
    if (!input.id) continue;
    const value = input.value;
    out[input.id] = value == null ? "" : String(value);
  }
  return out;
}

export type InputValidationError = "field-too-long" | "total-too-large";

/** 提交前预校验大小上限。合法返回 null，否则返回错误类型（供 i18n 提示）。 */
export function validateCardInputs(
  inputs: Record<string, string>
): InputValidationError | null {
  const enc = new TextEncoder();
  let total = 0;
  for (const [key, value] of Object.entries(inputs)) {
    const valueBytes = enc.encode(value).length;
    if (valueBytes > MAX_FIELD_BYTES) return "field-too-long";
    total += enc.encode(key).length + valueBytes;
  }
  if (total > MAX_TOTAL_BYTES) return "total-too-large";
  return null;
}
