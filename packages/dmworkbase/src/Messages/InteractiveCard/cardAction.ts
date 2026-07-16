import { ChannelTypePerson } from "wukongimjssdk";
import WKApp from "../../App";

/**
 * 解析卡片动作上行请求的 `channel_id`（person DM 对端塌缩兜底）。
 *
 * 服务端把 person 频道的 `channel_id` 当作**对端 uid**，按 `fakeChannel(loginUID,
 * channel_id)` 定位存储行。正常 1v1 里 `message.channel.channelID` 已是对端；但与
 * 系统 bot（如 `notification`，docs / smart-summary 审批卡都经它下发）的 DM，其 recv
 * 包 channelID 会塌缩为**接收人自身 uid**（WuKongIM「receiver as container」路径，未做
 * 常规 personal 对端翻转），此时若直接回传 channelID=self，服务端算出 `fakeChannel(self,
 * self)` 必然 miss → 400 `card_action_invalid`。
 *
 * received 消息的权威对端是 `message.fromUID`（与 WKSDK `message.send` getter 同源），
 * 故当 person 频道 channelID 塌缩为 self 时回退到 fromUID。group/topic（channelID=群号）
 * 与 channelID 已是对端的普通 DM 条件均不成立 → 原样返回（fallback 为 no-op，无需 per-bot
 * 白名单）。selfUID / fromUID 缺失时同样保守保留 channelID，不崩。
 */
export function resolveCardActionChannelId(params: {
  channelType: number;
  channelID: string;
  fromUID?: string;
  selfUID?: string;
}): string {
  const { channelType, channelID, fromUID, selfUID } = params;
  if (
    channelType === ChannelTypePerson &&
    !!selfUID &&
    channelID === selfUID &&
    !!fromUID
  ) {
    return fromUID;
  }
  return channelID;
}

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
