import WKApp from "../../App";

/**
 * 卡片动作提交（octo/v2 交互闭环，契约 §7.1）。
 *
 * 请求体**刻意不含 `data`**（D11 防伪造）：服务端从存储帧的 Action.Submit 提取 data，
 * 客户端只回传 `action_id` + `inputs`（声明的 Input.* id → 字符串值）+ `client_token`（关联 ID）。
 *
 * base 为 `/v1/`，故路径 `message/card/action`；token/space 由 apiClient config 自动附带。
 */

export interface SubmitCardActionParams {
  messageId: string;
  channelId: string;
  channelType: number;
  /** 当前帧 Action.Submit 的 id，原样回传。 */
  actionId: string;
  /** 声明的 Input.* id → 字符串值；无输入则 {}。 */
  inputs: Record<string, string>;
}

/** 服务端异步 ack：{accepted, replay}。replay（重复动作重放）同样视为成功。 */
export interface CardActionResult {
  accepted: boolean;
  replay: boolean;
}

export async function submitCardAction(
  params: SubmitCardActionParams
): Promise<CardActionResult> {
  const clientToken = WKApp.shared.generateUUID();
  const resp = await WKApp.apiClient.post("message/card/action", {
    message_id: params.messageId,
    channel_id: params.channelId,
    channel_type: params.channelType,
    action_id: params.actionId,
    inputs: params.inputs,
    client_token: clientToken,
    // 注意：绝不传 data —— 服务端从存储帧提取（D11）。
  });
  const data = (resp ?? {}) as { accepted?: boolean; replay?: boolean };
  // 缺字段时保守视为已受理（2xx 即成功）。
  return { accepted: data.accepted !== false, replay: !!data.replay };
}

/**
 * 提交失败是否可重试（恢复按钮再点）：
 *   - 409（ErrMessageCardActionInProgress，进行中）；
 *   - 5xx（服务端错误）。
 * 400（非法）/ 403（非成员）等视为终态失败，不重试。
 */
export function isRetryableCardActionError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 409 || (typeof status === "number" && status >= 500);
}
