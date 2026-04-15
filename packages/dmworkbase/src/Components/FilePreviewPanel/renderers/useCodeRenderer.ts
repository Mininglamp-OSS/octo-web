import { useMemo } from "react";
import { BaseRendererProps } from "../types";
import { useFileContent, UseFileContentResult } from "../hooks/useFileContent";
import {
  FILE_SIZE_THRESHOLD,
  formatFileSize,
  getRenderMode,
  shouldFetchContent,
  RenderMode,
} from "../config";

export interface CodeRendererOptions {
  /** 语言类型（用于 SyntaxHighlighter） */
  language?: string;
  /** 是否启用语法高亮 */
  enableHighlight?: boolean;
  /** 内容格式化函数 */
  formatter?: (content: string) => string;
}

export interface UseCodeRendererResult extends UseFileContentResult {
  /** 文件大小 */
  fileSize: number;
  /** 内容实际大小（UTF-8） */
  contentSize: number;
  /** 渲染模式 */
  renderMode: RenderMode;
  /** 格式化后的内容 */
  formattedContent: string;
}

/**
 * 代码渲染器 Hook
 * 整合内容加载 + 分级策略 + 格式化
 */
export function useCodeRenderer(
  file: BaseRendererProps["file"],
  options: CodeRendererOptions = {}
): UseCodeRendererResult {
  const { language: _language, enableHighlight = true, formatter } = options;
  const fileSize = file.size || 0;

  const { content, loading, error, reload } = useFileContent({
    url: file.url,
    enabled: shouldFetchContent(fileSize),
  });

  const contentSize = useMemo(() => {
    return content ? new Blob([content]).size : fileSize;
  }, [content, fileSize]);

  const renderMode = useMemo(() => {
    return getRenderMode(contentSize);
  }, [contentSize]);

  const formattedContent = useMemo(() => {
    if (!content) return "";
    if (formatter) {
      return formatter(content);
    }
    return content.replace(/\n$/, "");
  }, [content, formatter]);

  return {
    content,
    contentSize,
    fileSize,
    loading,
    error,
    reload,
    renderMode,
    formattedContent,
  };
}

export default useCodeRenderer;
