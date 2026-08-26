import React, { useEffect, useRef, useState } from "react";
import { X, FolderOpen } from "lucide-react";
import { ConversationFile } from "./FilePreviewHeader";
import { formatFileSize, isImageType } from "./config";
import { getFileIcon as getFileIconUrl } from "../../Utils/fileIcon";
import { useI18n } from "../../i18n";
import type { I18nFormatter } from "../../i18n";
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
  /** 是否还有更多数据 */
  hasMore?: boolean;
  /** 是否正在加载更多 */
  loadingMore?: boolean;
  /** 加载更多回调 */
  onLoadMore?: () => void;
  /** 当前页码（用于判断是否显示"没有更多了"） */
  currentPage?: number;
  /** 是否正在初始加载 */
  initialLoading?: boolean;
}

/** 根据扩展名获取文件图标 */
function getFileIcon(extension: string, fileName?: string): React.ReactNode {
  const name = fileName || `file.${extension}`;
  const iconUrl = getFileIconUrl(name, "");
  return (
    <img
      src={iconUrl}
      alt=""
      className="wk-file-list-panel__item-file-icon"
      draggable={false}
    />
  );
}

/** 格式化时间戳为相对时间或日期 */
function formatTime(timestamp: number | undefined, format: I18nFormatter): string {
  if (!timestamp) return "";

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // 使用 Math.max 防止时钟偏差导致负数
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) {
    // 今天：显示时间
    return format.time(date, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (diffDays === 1) {
    return format.relativeTime(-1, "day");
  } else if (diffDays < 7) {
    return format.relativeTime(-diffDays, "day");
  } else {
    // 超过7天：显示日期
    return format.date(date, { month: "short", day: "numeric" });
  }
}

/** 文件列表项组件 */
const FileListItem: React.FC<{
  file: ConversationFile;
  isActive: boolean;
  onSelect: () => void;
}> = ({ file, isActive, onSelect }) => {
  const [thumbError, setThumbError] = useState(false);
  const { format } = useI18n();
  const isImage = isImageType(file.category, file.extension);
  // 图片类型直接用 url 作为缩略图
  const showThumbnail = isImage && file.url && !thumbError;

  return (
    <div
      className={`wk-file-list-panel__item ${
        isActive ? "wk-file-list-panel__item--active" : ""
      }`}
      onClick={onSelect}
      title={file.name}
    >
      {/* 文件图标或缩略图 */}
      <span
        className={`wk-file-list-panel__item-icon ${
          showThumbnail ? "wk-file-list-panel__item-icon--thumbnail" : ""
        }`}
      >
        {showThumbnail ? (
          <img
            src={file.url}
            alt=""
            className="wk-file-list-panel__item-thumbnail"
            onError={() => setThumbError(true)}
          />
        ) : (
          getFileIcon(file.extension, file.name)
        )}
      </span>

      {/* 文件信息 */}
      <div className="wk-file-list-panel__item-info">
        <span className="wk-file-list-panel__item-name">{file.name}</span>
        <div className="wk-file-list-panel__item-meta">
          {file.senderName && (
            <span className="wk-file-list-panel__item-sender">
              {file.senderName}
            </span>
          )}
          {/* 图片类型不展示大小，且 size 必须大于 0 */}
          {!isImage && file.size != null && file.size > 0 && (
            <span className="wk-file-list-panel__item-size">
              {formatFileSize(file.size)}
            </span>
          )}
          {file.timestamp && (
            <span className="wk-file-list-panel__item-time">
              {formatTime(file.timestamp, format)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 侧边文件列表面板
 *
 * 显示对话内的所有文件，支持快速切换预览和触底加载
 */
const FileListPanel: React.FC<FileListPanelProps> = ({
  files,
  currentFileUrl,
  onFileSelect,
  onClose,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  currentPage = 1,
  initialLoading = false,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

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

  // 触底加载
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl || !onLoadMore) return;

    const handleScroll = () => {
      if (loadingMore || !hasMore) return;

      const { scrollTop, scrollHeight, clientHeight } = listEl;
      // 距离底部 50px 时触发加载
      if (scrollHeight - scrollTop - clientHeight < 50) {
        onLoadMore();
      }
    };

    listEl.addEventListener("scroll", handleScroll);
    return () => listEl.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <div className="wk-file-list-panel">
      {/* Header */}
      <div className="wk-file-list-panel__header">
        <span className="wk-file-list-panel__title">
          {t("base.filePreview.conversationFiles")}
        </span>
        <span className="wk-file-list-panel__count">{files.length}</span>
        {onClose && (
          <button
            className="wk-file-list-panel__close-btn"
            onClick={onClose}
            title={t("base.filePreview.close")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 文件列表 */}
      <div className="wk-file-list-panel__list" ref={listRef}>
        {initialLoading ? (
          <div className="wk-file-list-panel__loading">
            {t("base.filePreview.loading")}
          </div>
        ) : files.length === 0 ? (
          <div className="wk-file-list-panel__empty">
            <FolderOpen size={32} className="wk-file-list-panel__empty-icon" />
            <span className="wk-file-list-panel__empty-text">
              {t("base.filePreview.noFiles")}
            </span>
          </div>
        ) : (
          <>
            {files.map((file) => (
              <FileListItem
                key={file.id}
                file={file}
                isActive={file.url === currentFileUrl}
                onSelect={() => onFileSelect?.(file)}
              />
            ))}
            {/* 加载更多状态 */}
            {loadingMore && (
              <div className="wk-file-list-panel__loading">
                {t("base.filePreview.loading")}
              </div>
            )}
            {/* 没有更多数据（仅在加载过至少一页后显示） */}
            {!hasMore && files.length > 0 && currentPage >= 1 && (
              <div className="wk-file-list-panel__no-more">
                {t("base.filePreview.noMore")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FileListPanel;
export { FileListPanel };
