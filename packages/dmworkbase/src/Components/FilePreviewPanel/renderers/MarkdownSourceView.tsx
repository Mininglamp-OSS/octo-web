import React, { useMemo } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { formatFileSize, getRenderMode } from "../config";
import { useI18n } from "../../../i18n";
import { Empty } from "@octo/ui";
import "./MarkdownSourceView.css";
import "./code-highlight.css";

export interface MarkdownSourceViewProps {
  /** Markdown 源码内容 */
  content: string;
  /** 内容大小（字节），用于分级渲染判断。如不传则自动计算 */
  contentSize?: number;
}

/**
 * Markdown 源码视图组件
 *
 * 功能：
 * 1. 分级渲染（阈值见 config.ts 中的 FILE_SIZE_THRESHOLD）：
 *    - ≤ HIGHLIGHT: SyntaxHighlighter 语法高亮
 *    - HIGHLIGHT ~ PLAIN_TEXT: 纯文本渲染（无高亮）
 *    - > PLAIN_TEXT: 由外层处理（显示 FileTooLarge）
 * 2. 显示行号（仅高亮模式）
 * 3. 等宽字体展示
 */
const MarkdownSourceView: React.FC<MarkdownSourceViewProps> = ({
  content,
  contentSize: externalContentSize,
}) => {
  const { t } = useI18n();
  // 计算内容大小
  const contentSize = useMemo(() => {
    if (externalContentSize !== undefined) return externalContentSize;
    return content ? new Blob([content]).size : 0;
  }, [content, externalContentSize]);

  // 获取渲染模式
  const renderMode = useMemo(() => getRenderMode(contentSize), [contentSize]);

  if (!content || content.trim() === "") {
    return (
      <div className="wk-markdown-source-view wk-markdown-source-view--empty">
        <Empty
          illustration={false}
          description={t("base.filePreview.empty")}
        />
      </div>
    );
  }

  // 纯文本模式（HIGHLIGHT ~ PLAIN_TEXT 阈值范围）
  if (renderMode === "plain") {
    return (
      <div className="wk-markdown-source-view">
        <div className="wk-markdown-source-view__plain-hint">
          {t("base.filePreview.largeFilePlainHintPerf", {
            values: { size: formatFileSize(contentSize) },
          })}
        </div>
        <pre className="wk-markdown-source-view__plain-source">
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  // 高亮模式（≤ HIGHLIGHT 阈值）
  return (
    <div className="wk-markdown-source-view wk-code-highlight-container">
      <SyntaxHighlighter
        language="markdown"
        useInlineStyles={false}
        showLineNumbers
        wrapLines
        lineNumberStyle={{
          minWidth: "3em",
          paddingRight: "1em",
          textAlign: "right",
          userSelect: "none",
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

export default MarkdownSourceView;
export { MarkdownSourceView };
