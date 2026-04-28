import React, { useEffect, useRef } from "react";
import {
  File,
  FileImage,
  FileCode,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileArchive,
  FileAudio,
  FileVideo,
  X,
} from "lucide-react";
import { ConversationFile } from "./FilePreviewHeader";
import { formatFileSize } from "./config";
import "./FileListPanel.css";

export interface FileListPanelProps {
  /** 文件列表 */
  files: ConversationFile[];
  /** 当前选中的文件 URL */
  currentFileUrl?: string;
  /** 选择文件回调 */
  onFileSelect?: (file: ConversationFile) => void;
  /** 关闭面板回调 */
  onClose?: () => void;
}

/** 根据扩展名获取文件图标 */
function getFileIcon(extension: string): React.ReactNode {
  const ext = extension.toLowerCase();

  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext)) {
    return <FileImage size={16} />;
  }
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
      "json",
      "jsonl",
    ].includes(ext)
  ) {
    return <FileCode size={16} />;
  }
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) {
    return <FileText size={16} />;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={16} />;
  }
  if (["ppt", "pptx"].includes(ext)) {
    return <Presentation size={16} />;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return <FileArchive size={16} />;
  }
  if (["mp3", "wav", "aac", "flac", "ogg"].includes(ext)) {
    return <FileAudio size={16} />;
  }
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) {
    return <FileVideo size={16} />;
  }

  return <File size={16} />;
}

/** 格式化时间戳为相对时间或日期 */
function formatTime(timestamp?: number): string {
  if (!timestamp) return "";

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // 使用 Math.max 防止时钟偏差导致负数
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) {
    // 今天：显示时间
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (diffDays === 1) {
    return "昨天";
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else {
    // 超过7天：显示日期
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }
}

/**
 * 侧边文件列表面板
 *
 * 显示对话内的所有文件，支持快速切换预览
 */
const FileListPanel: React.FC<FileListPanelProps> = ({
  files,
  currentFileUrl,
  onFileSelect,
  onClose,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 组件挂载或当前文件变化时，自动滚动到当前选中的文件
  useEffect(() => {
    if (listRef.current && currentFileUrl) {
      const activeItem = listRef.current.querySelector(
        ".wk-file-list-panel__item--active"
      ) as HTMLElement | null;
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  }, [currentFileUrl]);

  return (
    <div className="wk-file-list-panel">
      {/* Header */}
      <div className="wk-file-list-panel__header">
        <span className="wk-file-list-panel__title">对话内文件</span>
        <span className="wk-file-list-panel__count">{files.length}</span>
        {onClose && (
          <button
            className="wk-file-list-panel__close-btn"
            onClick={onClose}
            title="关闭"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 文件列表 */}
      <div className="wk-file-list-panel__list" ref={listRef}>
        {files.length === 0 ? (
          <div className="wk-file-list-panel__empty">暂无文件</div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className={`wk-file-list-panel__item ${
                file.url === currentFileUrl
                  ? "wk-file-list-panel__item--active"
                  : ""
              }`}
              onClick={() => onFileSelect?.(file)}
              title={file.name}
            >
              {/* 文件图标 */}
              <span className="wk-file-list-panel__item-icon">
                {getFileIcon(file.extension)}
              </span>

              {/* 文件信息 */}
              <div className="wk-file-list-panel__item-info">
                <span className="wk-file-list-panel__item-name">
                  {file.name}
                </span>
                <div className="wk-file-list-panel__item-meta">
                  {file.senderName && (
                    <span className="wk-file-list-panel__item-sender">
                      {file.senderName}
                    </span>
                  )}
                  {file.size && (
                    <span className="wk-file-list-panel__item-size">
                      {formatFileSize(file.size)}
                    </span>
                  )}
                  {file.timestamp && (
                    <span className="wk-file-list-panel__item-time">
                      {formatTime(file.timestamp)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FileListPanel;
export { FileListPanel };
