import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { ArrowLeft, List } from "lucide-react";
import {
  IconLaunch,
  IconMessage,
  IconDownload,
  IconClose,
  IconDropdown,
} from "./icons";
import { getFileIcon as getFileIconUrl } from "../../Utils/fileIcon";
import { downloadFile } from "../../Utils/download";
import { FilePreviewInfo } from "./types";
import { isImageType } from "./config";
import { useI18n } from "../../i18n";
import { Loading } from "@octo/ui";
import "./FilePreviewHeader.css";

/** 对话内文件项 */
export interface ConversationFile {
  /** 文件唯一标识（message_id） */
  id: string;
  /** 消息序号（用于回复定位） */
  messageSeq?: number;
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
  /** 文件分类（image/video/file 等） */
  category?: string;
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
  /** 回复消息回调 */
  onReply?: () => void;
  /** 当前视图模式 */
  viewMode?: "preview" | "source";
  /** 切换视图模式回调 */
  onViewModeChange?: (mode: "preview" | "source") => void;
  /** 是否显示视图切换（仅代码/HTML等类型显示） */
  showViewToggle?: boolean;

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

  /** 文件列表是否还有更多数据 */
  hasMoreFiles?: boolean;
  /** 文件列表是否正在加载更多 */
  loadingMoreFiles?: boolean;
  /** 加载更多文件回调 */
  onLoadMoreFiles?: () => void;
  /** 当前文件列表页码（用于判断是否显示"没有更多了"） */
  currentFilesPage?: number;
}

/** Hover 下拉列表项组件 */
const DropdownFileItem = memo(
  ({
    fileItem,
    isActive,
    onClick,
  }: {
    fileItem: ConversationFile;
    isActive: boolean;
    onClick: () => void;
  }) => {
    const [thumbError, setThumbError] = useState(false);
    const isImage = isImageType(fileItem.category, fileItem.extension);
    const showThumbnail = isImage && fileItem.url && !thumbError;

    return (
      <div
        className={`wk-file-preview-header__dropdown-item ${
          isActive ? "wk-file-preview-header__dropdown-item--active" : ""
        }`}
        onClick={onClick}
      >
        <span
          className={`wk-file-preview-header__dropdown-item-icon ${
            showThumbnail
              ? "wk-file-preview-header__dropdown-item-icon--thumbnail"
              : ""
          }`}
        >
          {showThumbnail ? (
            <img
              src={fileItem.url}
              alt=""
              className="wk-file-preview-header__dropdown-item-thumbnail"
              onError={() => setThumbError(true)}
            />
          ) : (
            getFileIcon(fileItem.extension, fileItem.name)
          )}
        </span>
        <span
          className="wk-file-preview-header__dropdown-item-name"
          title={fileItem.name}
        >
          {fileItem.name}
        </span>
      </div>
    );
  }
);

/** 根据扩展名获取文件图标 */
function getFileIcon(extension: string, fileName?: string): React.ReactNode {
  const name = fileName || `file.${extension}`;
  const iconUrl = getFileIconUrl(name, "");
  return (
    <img
      src={iconUrl}
      alt=""
      className="wk-file-preview-header__file-icon"
      draggable={false}
    />
  );
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
  onReply,
  viewMode = "preview",
  onViewModeChange,
  showViewToggle = false,

  isFilePanelOpen = false,
  onFilePanelToggle,

  showTocButton = false,
  isTocOpen = false,
  onTocToggle,

  showBackButton = false,
  onBack,

  hasMoreFiles = false,
  loadingMoreFiles = false,
  onLoadMoreFiles,
  currentFilesPage = 1,
}) => {
  const [hoverDropdownOpen, setHoverDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownListRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const { t } = useI18n();

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
  // 组件挂载或当前文件变化时，自动滚动到当前选中的文件
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

  // hover 下拉列表触底加载
  useEffect(() => {
    const listEl = dropdownListRef.current;
    if (!listEl || !onLoadMoreFiles || !hoverDropdownOpen) return;

    const handleScroll = () => {
      if (loadingMoreFiles || !hasMoreFiles) return;

      const { scrollTop, scrollHeight, clientHeight } = listEl;
      // 距离底部 50px 时触发加载
      if (scrollHeight - scrollTop - clientHeight < 50) {
        onLoadMoreFiles();
      }
    };

    listEl.addEventListener("scroll", handleScroll);
    return () => listEl.removeEventListener("scroll", handleScroll);
  }, [hoverDropdownOpen, hasMoreFiles, loadingMoreFiles, onLoadMoreFiles]);

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
      void downloadFile(file.url, file.name || "file");
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
        {/* 返回按钮（从子区进入文件预览时显示） */}
        {showBackButton && onBack && (
          <button
            className="wk-file-preview-header__btn wk-file-preview-header__btn--back"
            onClick={onBack}
            title={t("base.filePreview.backToThread")}
          >
            <ArrowLeft size={16} />
          </button>
        )}
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
            {getFileIcon(file.extension, file.name)}
            <span className="wk-file-preview-header__dropdown-text">
              {file.name}
            </span>
            {hasFiles && (
              <IconDropdown
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
              <div
                className="wk-file-preview-header__dropdown-list"
                ref={dropdownListRef}
              >
                {fileList.map((fileItem) => (
                  <DropdownFileItem
                    key={fileItem.id}
                    fileItem={fileItem}
                    isActive={fileItem.url === file.url}
                    onClick={() => handleFileClick(fileItem)}
                  />
                ))}
                {/* 加载更多状态 */}
                {loadingMoreFiles && (
                  <div className="wk-file-preview-header__dropdown-loading">
                    <Loading size="sm" text={t("base.filePreview.loading")} />
                  </div>
                )}
                {/* 没有更多数据（仅在加载过至少一页后显示） */}
                {!hasMoreFiles &&
                  fileList.length > 0 &&
                  (currentFilesPage ?? 1) >= 1 && (
                    <div className="wk-file-preview-header__dropdown-no-more">
                      {t("base.filePreview.noMore")}
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：操作按钮区域 */}
      <div className="wk-file-preview-header__actions">
        {/* 视图切换（预览/源码）*/}
        {showViewToggle && onViewModeChange && (
          <>
            <div className="wk-file-preview-header__view-toggle">
              <button
                className={`wk-file-preview-header__view-toggle-btn ${
                  viewMode === "preview"
                    ? "wk-file-preview-header__view-toggle-btn--active"
                    : ""
                }`}
                onClick={() => onViewModeChange("preview")}
              >
                {t("base.filePreview.preview")}
              </button>
              <button
                className={`wk-file-preview-header__view-toggle-btn ${
                  viewMode === "source"
                    ? "wk-file-preview-header__view-toggle-btn--active"
                    : ""
                }`}
                onClick={() => onViewModeChange("source")}
              >
                {t("base.filePreview.source")}
              </button>
            </div>
            <span className="wk-file-preview-header__sep" />
          </>
        )}

        {/* 目录按钮（仅 Markdown 预览模式且 h2 ≥ 3 时显示） */}
        {showTocButton && onTocToggle && (
          <button
            className={`wk-file-preview-header__btn ${
              isTocOpen ? "wk-file-preview-header__btn--active" : ""
            }`}
            onClick={onTocToggle}
            title={
              isTocOpen
                ? t("base.filePreview.collapseToc")
                : t("base.filePreview.expandToc")
            }
          >
            <List size={12} />
          </button>
        )}

        {/* 新标签打开 */}
        {showOpenExternal && (
          <button
            className="wk-file-preview-header__btn"
            onClick={handleOpenExternal}
            title={t("base.filePreview.openInNewTab")}
          >
            <IconLaunch />
          </button>
        )}

        {/* 回复 */}
        {onReply && (
          <button
            className="wk-file-preview-header__btn"
            onClick={onReply}
            title={t("base.filePreview.reply")}
          >
            <IconMessage />
          </button>
        )}

        {/* 下载 */}
        <button
          className="wk-file-preview-header__btn"
          onClick={handleDownload}
          title={t("base.filePreview.download")}
        >
          <IconDownload />
        </button>

        {/* 分隔线 */}
        <span className="wk-file-preview-header__sep" />

        {/* 关闭 */}
        <button
          className="wk-file-preview-header__btn wk-file-preview-header__btn--close"
          onClick={onClose}
          title={t("base.filePreview.close")}
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
};

export default FilePreviewHeader;
export { FilePreviewHeader };
