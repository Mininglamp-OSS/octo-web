import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronDown,
  FileText,
  Download,
  ExternalLink,
  Maximize2,
  Reply,
  X,
  File,
  FileImage,
  FileCode,
  FileSpreadsheet,
  Presentation,
  FileArchive,
  FileAudio,
  FileVideo,
  List,
} from "lucide-react";
import { FilePreviewInfo } from "./types";
import "./FilePreviewHeader.css";

/** 对话内文件项 */
export interface ConversationFile {
  /** 文件唯一标识 */
  id: string;
  /** 文件名 */
  name: string;
  /** 扩展名 */
  extension: string;
  /** 文件 URL */
  url: string;
  /** 文件大小 */
  size?: number;
  /** 是否 AI 生成 */
  isAiGenerated?: boolean;
  /** 发送者 UID */
  senderUid?: string;
  /** 发送者名称 */
  senderName?: string;
  /** 发送时间戳（秒） */
  timestamp?: number;
}

export interface FilePreviewHeaderProps {
  /** 当前预览的文件 */
  file: FilePreviewInfo;
  /** 对话内所有文件列表 */
  conversationFiles?: ConversationFile[];
  /** 切换文件回调 */
  onFileSelect?: (file: ConversationFile) => void;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 下载文件回调 */
  onDownload?: () => void;
  /** 新标签打开回调 */
  onOpenExternal?: () => void;
  /** 是否显示新标签打开按钮（默认 false，仅 HTML 文件显示） */
  showOpenExternal?: boolean;
  /** 全屏预览回调 */
  onFullscreen?: () => void;
  /** 回复消息回调 */
  onReply?: () => void;
  /** 当前视图模式 */
  viewMode?: "preview" | "source";
  /** 切换视图模式回调 */
  onViewModeChange?: (mode: "preview" | "source") => void;
  /** 是否显示视图切换（仅代码/HTML等类型显示） */
  showViewToggle?: boolean;
  /** 自定义中间区域内容（类型相关工具） */
  typeTools?: React.ReactNode;

  /** 侧边文件列表面板是否打开 */
  isFilePanelOpen?: boolean;
  /** 切换侧边文件列表面板 */
  onFilePanelToggle?: () => void;

  /** 是否显示 TOC 按钮（仅 Markdown 预览模式且 h2 ≥ 3 时显示） */
  showTocButton?: boolean;
  /** TOC 侧边栏是否展开 */
  isTocOpen?: boolean;
  /** 切换 TOC 展开/收起 */
  onTocToggle?: () => void;

  /** 是否显示返回按钮（从子区进入文件预览时显示） */
  showBackButton?: boolean;
  /** 返回按钮点击回调 */
  onBack?: () => void;
}

/** 根据扩展名获取文件图标 */
function getFileIcon(extension: string): React.ReactNode {
  const ext = extension.toLowerCase();

  // 图片
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext)) {
    return <FileImage size={14} />;
  }
  // 代码
  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "go",
      "rs",
      "rb",
      "php",
      "vue",
      "html",
      "css",
      "scss",
      "less",
    ].includes(ext)
  ) {
    return <FileCode size={14} />;
  }
  // PDF/文档
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) {
    return <FileText size={14} />;
  }
  // 表格
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={14} />;
  }
  // PPT
  if (["ppt", "pptx"].includes(ext)) {
    return <Presentation size={14} />;
  }
  // 压缩包
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return <FileArchive size={14} />;
  }
  // 音频
  if (["mp3", "wav", "aac", "flac", "ogg"].includes(ext)) {
    return <FileAudio size={14} />;
  }
  // 视频
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) {
    return <FileVideo size={14} />;
  }
  // JSON
  if (["json", "jsonl"].includes(ext)) {
    return <FileCode size={14} />;
  }

  return <File size={14} />;
}

/**
 * 文件预览面板统一 Header 组件
 *
 * 交互逻辑：
 * 1. 侧边面板关闭时：hover 文件选择器显示浮窗下拉列表
 * 2. 点击文件选择器：切换侧边文件列表面板的展开/收起
 */
const FilePreviewHeader: React.FC<FilePreviewHeaderProps> = ({
  file,
  conversationFiles = [],
  onFileSelect,
  onClose,
  onDownload,
  onOpenExternal,
  showOpenExternal = false,
  onFullscreen,
  onReply,
  viewMode = "preview",
  onViewModeChange,
  showViewToggle = false,
  typeTools,

  isFilePanelOpen = false,
  onFilePanelToggle,

  showTocButton = false,
  isTocOpen = false,
  onTocToggle,

  showBackButton = false,
  onBack,
}) => {
  const [hoverDropdownOpen, setHoverDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownListRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const fileList = conversationFiles;
  const hasFiles = fileList.length > 0;

  // 清理 hover timeout
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // 鼠标进入：仅在侧边面板关闭时显示浮窗
  const handleMouseEnter = useCallback(() => {
    if (!isFilePanelOpen && hasFiles) {
      clearHoverTimeout();
      hoverTimeoutRef.current = window.setTimeout(() => {
        setHoverDropdownOpen(true);
      }, 200); // 200ms 延迟，避免快速划过触发
    }
  }, [isFilePanelOpen, hasFiles, clearHoverTimeout]);

  // 浮窗显示后，自动滚动到当前选中的文件
  useEffect(() => {
    if (hoverDropdownOpen && dropdownListRef.current) {
      const activeItem = dropdownListRef.current.querySelector(
        ".wk-file-preview-header__dropdown-item--active"
      ) as HTMLElement | null;
      if (activeItem) {
        // 使用 scrollIntoView 让当前文件可见，block: 'nearest' 避免不必要的滚动
        activeItem.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  }, [hoverDropdownOpen]);

  // 鼠标离开：关闭浮窗
  const handleMouseLeave = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverDropdownOpen(false);
    }, 150); // 150ms 延迟，允许鼠标移到下拉面板
  }, [clearHoverTimeout]);

  // 点击：切换侧边面板
  const handleClick = useCallback(() => {
    if (hasFiles && onFilePanelToggle) {
      setHoverDropdownOpen(false); // 关闭浮窗
      onFilePanelToggle();
    }
  }, [hasFiles, onFilePanelToggle]);

  // 选择文件
  const handleFileClick = useCallback(
    (fileItem: ConversationFile) => {
      setHoverDropdownOpen(false);
      onFileSelect?.(fileItem);
    },
    [onFileSelect]
  );

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearHoverTimeout();
    };
  }, [clearHoverTimeout]);

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      // 默认下载行为
      const a = document.createElement("a");
      a.href = file.url;
      a.download = file.name || "file";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleOpenExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
    } else {
      window.open(file.url, "_blank");
    }
  };

  // 是否显示浮窗：侧边面板关闭 && hover 状态 && 有文件
  const showHoverDropdown = !isFilePanelOpen && hoverDropdownOpen && hasFiles;

  return (
    <div className="wk-file-preview-header">
      {/* 左侧：文件选择器 */}
      <div className="wk-file-preview-header__left">
        {/* 文件下拉选择器 */}
        <div
          className="wk-file-preview-header__dropdown"
          ref={dropdownRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <button
            className={`wk-file-preview-header__dropdown-btn ${
              hasFiles ? "wk-file-preview-header__dropdown-btn--has-files" : ""
            } ${
              isFilePanelOpen || hoverDropdownOpen
                ? "wk-file-preview-header__dropdown-btn--open"
                : ""
            }`}
            onClick={handleClick}
            title={file.name}
          >
            {getFileIcon(file.extension)}
            <span className="wk-file-preview-header__dropdown-text">
              {file.name}
            </span>
            {hasFiles && (
              <ChevronDown
                size={12}
                className={`wk-file-preview-header__dropdown-caret ${
                  isFilePanelOpen
                    ? "wk-file-preview-header__dropdown-caret--open"
                    : ""
                }`}
              />
            )}
          </button>

          {/* Hover 浮窗下拉面板（仅在侧边面板关闭时显示） */}
          {showHoverDropdown && (
            <div
              className="wk-file-preview-header__dropdown-panel"
              onMouseEnter={() => clearHoverTimeout()}
              onMouseLeave={handleMouseLeave}
            >
              <div className="wk-file-preview-header__dropdown-title">
                对话内文件 · 点击展开列表
              </div>
              <div
                className="wk-file-preview-header__dropdown-list"
                ref={dropdownListRef}
              >
                {fileList.map((fileItem) => (
                  <div
                    key={fileItem.id}
                    className={`wk-file-preview-header__dropdown-item ${
                      fileItem.url === file.url
                        ? "wk-file-preview-header__dropdown-item--active"
                        : ""
                    }`}
                    onClick={() => handleFileClick(fileItem)}
                  >
                    <span className="wk-file-preview-header__dropdown-item-icon">
                      {getFileIcon(fileItem.extension)}
                    </span>
                    <span
                      className="wk-file-preview-header__dropdown-item-name"
                      title={fileItem.name}
                    >
                      {fileItem.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 分隔符 */}
        {showViewToggle && <span className="wk-file-preview-header__sep" />}

        {/* 视图切换（预览/源码） */}
        {showViewToggle && onViewModeChange && (
          <div className="wk-file-preview-header__view-toggle">
            <button
              className={`wk-file-preview-header__view-toggle-btn ${
                viewMode === "preview"
                  ? "wk-file-preview-header__view-toggle-btn--active"
                  : ""
              }`}
              onClick={() => onViewModeChange("preview")}
            >
              预览
            </button>
            <button
              className={`wk-file-preview-header__view-toggle-btn ${
                viewMode === "source"
                  ? "wk-file-preview-header__view-toggle-btn--active"
                  : ""
              }`}
              onClick={() => onViewModeChange("source")}
            >
              源码
            </button>
          </div>
        )}
      </div>

      {/* 中间：类型相关工具 */}
      <div className="wk-file-preview-header__mid">{typeTools}</div>

      {/* 右侧：通用操作按钮 */}
      <div className="wk-file-preview-header__actions">
        {/* 目录按钮（仅 Markdown 预览模式且 h2 ≥ 3 时显示） */}
        {showTocButton && onTocToggle && (
          <button
            className={`wk-file-preview-header__btn ${
              isTocOpen ? "wk-file-preview-header__btn--active" : ""
            }`}
            onClick={onTocToggle}
            title={isTocOpen ? "收起目录" : "展开目录"}
          >
            <List size={16} />
          </button>
        )}

        {/* 全屏 */}
        {onFullscreen && (
          <button
            className="wk-file-preview-header__btn"
            onClick={onFullscreen}
            title="全屏"
          >
            <Maximize2 size={16} />
          </button>
        )}

        {/* 新标签打开（仅 HTML 文件显示） */}
        {showOpenExternal && (
          <button
            className="wk-file-preview-header__btn"
            onClick={handleOpenExternal}
            title="新标签打开"
          >
            <ExternalLink size={16} />
          </button>
        )}

        {/* 回复 */}
        {onReply && (
          <button
            className="wk-file-preview-header__btn"
            onClick={onReply}
            title="回复"
          >
            <Reply size={16} />
          </button>
        )}

        {/* 下载 */}
        <button
          className="wk-file-preview-header__btn"
          onClick={handleDownload}
          title="下载"
        >
          <Download size={16} />
        </button>

        {/* 关闭 */}
        <button
          className="wk-file-preview-header__btn wk-file-preview-header__btn--close"
          onClick={onClose}
          title="关闭"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default FilePreviewHeader;
export { FilePreviewHeader };
