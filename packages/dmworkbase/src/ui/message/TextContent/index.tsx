import React from "react";
import MarkdownContent, {
  type MentionInfo,
  type EmojiInfo,
} from "../../../Messages/Text/MarkdownContent";
import "./index.css";

export interface TextContentProps {
  /** 消息文本内容（支持 Markdown） */
  content: string;

  /** @ 提及列表 */
  mentions?: MentionInfo[];

  /** Emoji 列表 */
  emojis?: EmojiInfo[];

  /** 是否为大表情（单个自定义 emoji，230×230） */
  isLargeEmoji?: boolean;

  /** 是否为流式消息（正在流式输出中） */
  isStreaming?: boolean;

  /** 点击 @ 提及回调 */
  onMentionClick?: (uid: string) => void;

  /** 是否启用 Markdown 语法渲染，默认 true */
  enableMarkdown?: boolean;
}

/**
 * 文本消息内容组件
 *
 * @description 渲染消息文本，支持 Markdown、@ 提及、Emoji
 *
 * @ 提及三等级（Figma 318:12716）：
 * - 交互实体：紫色文字 + 浅紫背景胶囊（type=entity）
 * - 强调色：纯紫色文字（@所有人）
 * - 降级：同正文色（未解析的 @）
 *
 * 大表情：
 * - 单个自定义 emoji 时，显示为 160×160
 */
export default function TextContent({
  content,
  mentions = [],
  emojis = [],
  isLargeEmoji = false,
  isStreaming = false,
  onMentionClick,
  enableMarkdown = true,
}: TextContentProps) {
  // 大表情：单独渲染
  if (isLargeEmoji && emojis.length === 1) {
    return (
      <div className="wk-msg-text-large-emoji">
        <img src={emojis[0].url} alt={emojis[0].key} width={230} height={230} />
      </div>
    );
  }

  // 普通文本：复用现有 MarkdownContent 组件
  return (
    <div className="wk-msg-text-content">
      <MarkdownContent
        content={content}
        isSend={false} // 不再区分发送方/接收方
        isStreaming={isStreaming}
        mentions={mentions}
        onMentionClick={onMentionClick}
        emojis={emojis}
        enableMarkdown={enableMarkdown}
      />
    </div>
  );
}
