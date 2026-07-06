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
  /** 消息 ID（用于标记激活态） */
  messageId?: string;
  /** 文件分类（image/video/document/code 等，用于判断文件类型） */
  category?: string;
  /** 消息序号（用于回复功能） */
  messageSeq?: number;
  /** 发送者 UID（用于回复功能） */
  fromUID?: string;
  /** 消息摘要（用于回复功能显示） */
  conversationDigest?: string;
  /**
   * 来源事项 ID（从事项详情面板触发预览时携带）。
   * Chat 页面用于在关闭/返回预览时回到对应事项详情，而不是退化到子区列表。
   */
  originMatterId?: string;
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
 *
 * 优先级: 文件名后缀 > content.extension。
 * 服务端返回的 extension 字段不可靠 (可能为空、或是 "file" 等占位值,
 * 见 issue #143), 用文件名后缀更稳妥; 文件名无可用后缀时再 fallback 到 extension。
 *
 * 后缀提取边界:
 *   - dot > 0       : 排除前导点的 dotfile (如 ".env" / ".bashrc"),
 *                     这类文件按 POSIX 语义没有"扩展名", 该 fallback。
 *   - dot < len-1   : 排除尾部点 (如 "report."), 提取出来是空串, 也该 fallback。
 */
export function getExtension(ext: string, name?: string): string {
  if (name) {
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
      return name.substring(dot + 1).toLowerCase();
    }
  }
  const e = (ext || "").toLowerCase();
  if (e) return e;
  return "";
}
