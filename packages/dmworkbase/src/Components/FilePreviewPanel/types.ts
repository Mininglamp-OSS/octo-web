import { ComponentType } from "react";

/** 文件预览信息 */
export interface FilePreviewInfo {
  url: string;
  name: string;
  extension: string;
  size?: number;
  /** 来源频道 ID（用于判断是否在子区面板内触发） */
  sourceChannelId?: string;
  /** 来源频道类型 */
  sourceChannelType?: number;
}

/** 渲染器状态数据（内部使用） */
export interface RendererStateData {
  loading: boolean;
  error: string | null;
  content: unknown;
}

/** 渲染器 Props 基类 */
export interface BaseRendererProps {
  file: FilePreviewInfo;
  onError?: (error: string) => void;
}

/** 渲染器组件类型 */
export type FileRenderer = ComponentType<BaseRendererProps>;

/** 文件类型枚举 */
export type FileType =
  | "image"
  | "pdf"
  | "markdown"
  | "code"
  | "json"
  | "jsonl"
  | "text"
  | "excel"
  | "ppt"
  | "video"
  | "audio"
  | "unknown";

/** 渲染器注册项 */
export interface RendererRegistryItem {
  type: FileType;
  extensions: string[];
  renderer: FileRenderer;
  /** 是否需要预加载内容 */
  needsFetch?: boolean;
}

/** FilePreviewPanel Props */
export interface FilePreviewPanelProps {
  file: FilePreviewInfo | null;
  onClose: () => void;
}

/** 加载状态 Props */
export interface LoadingStateProps {
  message?: string;
}

/** 错误状态 Props */
export interface ErrorStateProps {
  error: string;
  onRetry?: () => void;
}

/** 根据扩展名返回语言类型（用于代码高亮） */
export const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  markdown: "markdown",
};

/**
 * 根据文件扩展名获取语言标识
 */
export function getLanguageFromExtension(ext: string): string {
  const lowerExt = ext.toLowerCase();
  return LANGUAGE_MAP[lowerExt] || lowerExt;
}

/**
 * 从扩展名或文件名中提取扩展名
 */
export function getExtension(ext: string, name?: string): string {
  const e = (ext || "").toLowerCase();
  if (e) return e;
  if (name) {
    const dot = name.lastIndexOf(".");
    if (dot >= 0) return name.substring(dot + 1).toLowerCase();
  }
  return "";
}
