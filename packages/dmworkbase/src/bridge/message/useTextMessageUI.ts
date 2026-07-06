import { useMemo } from "react";
import WKApp from "../../App";
import type { MessageWrap, Part } from "../../Service/Model";
import { PartType } from "../../Service/Model";
import type { TextContentUIProps } from "./types";
import type { MentionInfo, EmojiInfo } from "../../Messages/Text/MarkdownContent";
import { buildTextMessageMentions } from "./textMessageMentions";
import {
  useMessageRow,
  getMessageRow,
  MessageRowSelectionState,
} from "./useMessageRow";

function getEffectiveContent(message: MessageWrap): unknown {
  const remoteExtra = message.remoteExtra ?? (message.message as any)?.remoteExtra;
  return remoteExtra?.isEdit && remoteExtra?.contentEdit
    ? remoteExtra.contentEdit
    : message.content;
}

function getRenderMentions(message: MessageWrap, parts: Part[]): MentionInfo[] {
  const remoteExtra = message.remoteExtra ?? (message.message as any)?.remoteExtra;
  const editContent =
    remoteExtra?.isEdit && remoteExtra?.contentEdit
      ? remoteExtra.contentEdit
      : undefined;

  return buildTextMessageMentions({
    parts: parts as any,
    content: message.content,
    editContent,
    partMentionType: PartType.mention as unknown as number,
  }) as MentionInfo[];
}

/**
 * getTextMessageUI - 纯函数版本
 *
 * @description 从 MessageWrap 提取 TextContent 组件需要的 UI 数据（不使用 hooks）
 *
 * @param message - 业务消息对象
 * @param selection - 多选状态（从 context 传入）
 * @returns TextContent 组件的 Props
 */
export function getTextMessageUI(
  message: MessageWrap,
  selection?: MessageRowSelectionState
) {
  const rowProps = getMessageRow(message, selection);

  // 流式消息：使用 fullStreamContent，不处理 mentions/emojis/isLargeEmoji
  if (message.streamOn) {
    return {
      row: rowProps,
      content: {
        content: message.fullStreamContent,
        isSend: message.send,
        mentions: [],
        emojis: [],
        isLargeEmoji: false,
        isStreaming: message.isStreaming,
      },
    };
  }

  const parts = message.parts || [];

  const mentions = getRenderMentions(message, parts);

  // 提取 emoji 列表（过滤掉无效 URL）
  const emojis: EmojiInfo[] = parts
    .filter((p: Part) => p.type === PartType.emoji)
    .reduce((acc: EmojiInfo[], p: Part) => {
      const url = WKApp.emojiService.getImage(p.text);
      if (url && !acc.find((e) => e.key === p.text)) {
        acc.push({ key: p.text, url });
      }
      return acc;
    }, []);

  // 判断是否为大表情（仅有一个 emoji part，无其他内容，且是 custom_ 图片）
  const emojiParts = parts.filter((p: Part) => p.type === PartType.emoji);
  const nonEmojiParts = parts.filter((p: Part) => p.type !== PartType.emoji);
  const isLargeEmoji =
    emojiParts.length === 1 &&
    nonEmojiParts.length === 0 &&
    emojis.length === 1 &&
    emojis[0].url.includes("/emoji/custom_");

  // 获取纯文本内容（优先使用编辑后的内容）
  const effectiveContent = getEffectiveContent(message) as any;
  const plainText =
    effectiveContent?.text || parts.map((p: Part) => p.text).join("") || "";

  return {
    row: rowProps,
    content: {
      content: plainText,
      isSend: message.send,
      mentions,
      emojis,
      isLargeEmoji,
    },
  };
}

/**
 * useTextMessageUI Hook
 *
 * @description 从 MessageWrap 提取 TextContent 组件需要的 UI 数据
 *
 * @param message - 业务消息对象
 * @returns TextContent 组件的 Props
 */
export function useTextMessageUI(message: MessageWrap) {
  const rowProps = useMessageRow(message);

  const contentProps = useMemo((): TextContentUIProps => {
    const parts = message.parts || [];

    const mentions = getRenderMentions(message, parts);

    // 提取 emoji 列表（过滤掉无效 URL）
    const emojis: EmojiInfo[] = parts
      .filter((p: Part) => p.type === PartType.emoji)
      .reduce((acc: EmojiInfo[], p: Part) => {
        const url = WKApp.emojiService.getImage(p.text);
        if (url && !acc.find((e) => e.key === p.text)) {
          acc.push({ key: p.text, url });
        }
        return acc;
      }, []);

    // 判断是否为大表情（仅有一个 emoji part，无其他内容，且是 custom_ 图片）
    const emojiParts = parts.filter((p: Part) => p.type === PartType.emoji);
    const nonEmojiParts = parts.filter((p: Part) => p.type !== PartType.emoji);
    const isLargeEmoji =
      emojiParts.length === 1 &&
      nonEmojiParts.length === 0 &&
      emojis.length === 1 &&
      emojis[0].url.includes("/emoji/custom_");

    // 获取纯文本内容（优先使用编辑后的内容）
    const effectiveContent = getEffectiveContent(message) as any;
    const plainText =
      effectiveContent?.text || parts.map((p: Part) => p.text).join("") || "";

    return {
      content: plainText,
      isSend: message.send,
      mentions,
      emojis,
      isLargeEmoji,
    };
  }, [message]);

  return {
    row: rowProps,
    content: contentProps,
  };
}
