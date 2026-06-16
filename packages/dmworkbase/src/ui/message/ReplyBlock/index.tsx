import React from "react";
import { linkifySafeUrls } from "../../../Utils/linkify";
import "./index.css";

export interface ReplyBlockProps {
  /** 被引用消息的发送者名字 */
  fromName: string;
  /** 引用内容摘要 */
  digest: string;
  /**
   * 被引用消息发送者的来源 Space 名称（相对当前查看 Space 解析后）。
   * 非空时，在昵称后以 `@{sourceSpaceName}` 形式内联展示，匹配消息头
   * 「@SpaceName」后缀（企微风格，dmwork-web#1069）。
   * 调用方负责调用 `resolveExternalForViewer`，避免把 WKApp 副作用引入纯 UI 组件。
   */
  sourceSpaceName?: string;
  /** 点击跳转到原消息 */
  onClick?: () => void;
}

function renderDigest(digest: string) {
  return linkifySafeUrls(digest).map((segment, index) => {
    if (segment.type === "text") return segment.content;
    return (
      <a
        key={`${index}-${segment.text}`}
        className="wk-reply-block__digest-link"
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {segment.text}
      </a>
    );
  });
}

/**
 * ReplyBlock — 引用消息块
 *
 * 对齐 Figma 387:62976
 * - 背景 rgba(28,28,35,0.03)，圆角 6px
 * - 左侧 2px 竖条 rgba(28,28,35,0.40)
 * - 发送者名：12px，rgba(28,28,35,0.60)
 * - 摘要：12px，rgba(28,28,35,0.60)，单行截断
 * - 外部成员来源：若 `sourceSpaceName` 非空，昵称后内联 `@SpaceName`
 */
export default function ReplyBlock({
  fromName,
  digest,
  sourceSpaceName,
  onClick,
}: ReplyBlockProps) {
  const hasSpaceSuffix =
    typeof sourceSpaceName === "string" && sourceSpaceName.length > 0;
  return (
    <div className="wk-reply-block" onClick={onClick}>
      <div className="wk-reply-block__bar" />
      <div className="wk-reply-block__content">
        <span className="wk-reply-block__name-row">
          <span className="wk-reply-block__name">{fromName}</span>
          {hasSpaceSuffix && (
            <span
              className="wk-reply-block__space"
              title={`@${sourceSpaceName}`}
            >
              @{sourceSpaceName}
            </span>
          )}
        </span>
        <span className="wk-reply-block__digest">{renderDigest(digest)}</span>
      </div>
    </div>
  );
}
