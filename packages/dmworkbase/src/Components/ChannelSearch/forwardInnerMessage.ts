import { MessageContentTypeConst } from "../../Service/Const";
import type {
  ChannelSearchDataSource,
  ChannelSearchForwardInnerMessage,
} from "./types";

export const FORWARD_INNER_MESSAGE_DISPLAY_LIMIT = 4;

type Translate = (
  key: string,
  options?: {
    values?: Record<string, string | number | boolean | null | undefined | Date>;
  }
) => string;

type GetChannelSearchSender = ChannelSearchDataSource["getSender"];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveForwardInnerMessageSenderName(
  message: ChannelSearchForwardInnerMessage,
  getSender: GetChannelSearchSender
) {
  if (message.senderName) return message.senderName;
  if (!message.senderUid) return "";
  const sender = getSender(message.senderUid);
  return sender.name && sender.name !== message.senderUid ? sender.name : "";
}

export function forwardInnerMessageFallbackText(type: number, t: Translate) {
  if (type === MessageContentTypeConst.image) {
    return t("base.channelSearch.forward.placeholder.image");
  }
  if (type === MessageContentTypeConst.smallVideo) {
    return t("base.channelSearch.forward.placeholder.video");
  }
  if (type === MessageContentTypeConst.file) {
    return t("base.channelSearch.forward.placeholder.file");
  }
  return t("base.channelSearch.forward.placeholder.message");
}

export function hasForwardInnerMessageSenderPrefix(
  text: string,
  senderName: string
) {
  const normalizedSenderName = senderName.trim();
  if (!normalizedSenderName) return false;
  const pattern = new RegExp(`^${escapeRegExp(normalizedSenderName)}\\s*[:：]`);
  return pattern.test(text.trimStart());
}

export function formatForwardInnerMessage(
  message: ChannelSearchForwardInnerMessage,
  getSender: GetChannelSearchSender,
  t: Translate
) {
  const text = message.text || forwardInnerMessageFallbackText(message.type, t);
  const senderName = resolveForwardInnerMessageSenderName(message, getSender);
  if (!senderName || hasForwardInnerMessageSenderPrefix(text, senderName)) {
    return text;
  }
  return `${senderName}：${text}`;
}

export function getForwardInnerMessageHiddenCount(
  totalInnerMessages: number,
  visibleCount: number,
  childCount?: number
) {
  const total =
    typeof childCount === "number" && childCount > totalInnerMessages
      ? childCount
      : totalInnerMessages;
  return Math.max(0, total - visibleCount);
}
