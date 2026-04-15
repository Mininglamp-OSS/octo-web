import React from "react";
import { BaseRendererProps } from "../types";
import { useCodeRenderer } from "./useCodeRenderer";
import { safeJsonParse } from "./json-utils";
import CodeRendererBase from "./CodeRendererBase";

export interface JsonRendererProps extends BaseRendererProps {}

/**
 * JSON 渲染器
 * 支持代码视图（格式化 JSON）
 *
 * 文件大小分级处理：
 * - < 30KB: 语法高亮渲染
 * - 30KB ~ 100KB: 纯文本渲染
 * - > 100KB: 不渲染，提示下载
 */
const JsonRenderer: React.FC<JsonRendererProps> = ({ file, onError }) => {
  const { loading, error, reload, renderMode, formattedContent, fileSize, contentSize } =
    useCodeRenderer(file, {
      language: "json",
      enableHighlight: true,
      formatter: (rawContent: string) => {
        const jsonData = safeJsonParse(rawContent, null);
        if (jsonData === null) return rawContent;
        return JSON.stringify(jsonData, null, 2);
      },
    });

  return (
    <CodeRendererBase
      file={file}
      renderMode={renderMode}
      formattedContent={formattedContent}
      language="json"
      loading={loading}
      error={error}
      onReload={reload}
      fileSize={fileSize}
      contentSize={contentSize}
    />
  );
};

export default JsonRenderer;
export { JsonRenderer };
