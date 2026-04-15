import React from "react";
import { BaseRendererProps } from "../types";
import { useCodeRenderer } from "./useCodeRenderer";
import CodeRendererBase from "./CodeRendererBase";

export interface TextRendererProps extends BaseRendererProps {}

/**
 * 纯文本渲染器
 * 支持 txt, log, ini, conf, cfg 格式
 *
 * 文件大小分级处理：
 * - < 30KB: 纯文本渲染
 * - 30KB ~ 100KB: 纯文本渲染
 * - > 100KB: 不渲染，提示下载
 */
const TextRenderer: React.FC<TextRendererProps> = ({ file, onError }) => {
  const { loading, error, reload, renderMode, formattedContent, fileSize, contentSize } =
    useCodeRenderer(file, {
      language: "text",
      enableHighlight: false,
    });

  return (
    <CodeRendererBase
      file={file}
      renderMode={renderMode}
      formattedContent={formattedContent}
      language="text"
      loading={loading}
      error={error}
      onReload={reload}
      fileSize={fileSize}
      contentSize={contentSize}
    />
  );
};

export default TextRenderer;
export { TextRenderer };
