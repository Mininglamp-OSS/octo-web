import React from "react";
import { BaseRendererProps, getLanguageFromExtension } from "../types";
import { useCodeRenderer } from "./useCodeRenderer";
import CodeRendererBase from "./CodeRendererBase";

export interface CodeRendererProps extends BaseRendererProps {}

/**
 * 代码渲染器
 * 使用 react-syntax-highlighter 实现语法高亮
 *
 * 文件大小分级处理：
 * - < 30KB: 语法高亮渲染
 * - 30KB ~ 100KB: 纯文本渲染（无高亮）
 * - > 100KB: 不渲染，提示下载
 */
const CodeRenderer: React.FC<CodeRendererProps> = ({ file, onError }) => {
  const language = getLanguageFromExtension(file.extension);

  const { loading, error, reload, renderMode, formattedContent, fileSize, contentSize } =
    useCodeRenderer(file, { language, enableHighlight: true });

  return (
    <CodeRendererBase
      file={file}
      renderMode={renderMode}
      formattedContent={formattedContent}
      language={language}
      loading={loading}
      error={error}
      onReload={reload}
      fileSize={fileSize}
      contentSize={contentSize}
    />
  );
};

export default CodeRenderer;
export { CodeRenderer };
