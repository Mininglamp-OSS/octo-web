import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  getFileIcon,
  formatFileSize,
} from "@octo/base/src/Components/MessageInput/AttachmentNode";
import { useI18n } from "@octo/base";
import type { MatterOutput } from "../../bridge/types";
import "./index.css";

/**
 * Format ISO datetime → "YYYY-MM-DD HH:mm:ss" (对齐 Figma 设计稿格式)。
 *
 * 故意用浏览器本地时区展示 sent_at, 不带 TZ 后缀。这是项目里 chat 时间
 * 戳的统一惯例 (用户在自己时区里看东西最自然)。后端 sent_at 通常是
 * ISO UTC, 浏览器 Date 自动转本地时区, 不要手动改成 UTC getter。
 */
function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── File thumbnail ─────────────────────────────────────
//
// 复用 dmworkbase 里项目自带的彩色文件图标 (跟 Figma 设计稿 node 440:5731 一致),
// 直接用 getFileIcon() 按文件名 + mime 类型挑图。

function FileThumbnail({
  fileName,
  mimeType,
}: {
  fileName?: string;
  mimeType?: string;
}) {
  const iconUrl = getFileIcon(fileName || "", mimeType || "");
  return (
    <div className="wk-outputs__thumb">
      <img src={iconUrl} alt="" width={32} height={32} />
    </div>
  );
}

// ─── Action icons (16x16, stroke = currentColor) ────────

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.33 8s2.4-4.67 6.67-4.67S14.67 8 14.67 8 12.27 12.67 8 12.67 1.33 8 1.33 8z"
        stroke="currentColor"
        strokeWidth="1.33"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.33" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M14 10v3.33a1.33 1.33 0 01-1.33 1.34H3.33A1.33 1.33 0 012 13.33V10M4.67 6.67L8 10l3.33-3.33M8 10V2"
        stroke="currentColor"
        strokeWidth="1.33"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Props ──────────────────────────────────────────────

export interface OutputChannelMembership {
  isMember: boolean;
  loading: boolean;
}

export interface OutputsPanelProps {
  outputs: MatterOutput[];
  loading?: boolean;
  hasMore?: boolean;
  query?: string;
  error?: string | null;
  onLoadMore?: () => void;
  onSearch?: (query: string) => void;
  onRetry?: () => void;
  /**
   * 渲染发送人头像。由调用方传入, 内部不直接调 WKAvatar/IM SDK,
   * 保持 ui/ 层与数据层分离 (跟 panel 现有模式一致)。
   */
  renderAvatar?: (uid: string, size: number) => React.ReactNode;
  /**
   * 文件预览回调。仅当事项详情嵌入在会话侧边栏时由调用方传入,
   * 此时操作列会显示 "眼睛" 按钮; 不传时不显示预览按钮 (独立事项页面场景)。
   */
  onPreview?: (item: MatterOutput) => void;
  /**
   * 文件下载回调。由调用方注入 (panel 用 resolveAndGuardUrl + downloadFile)
   * 保持 OutputsPanel 纯展示, 不依赖 WKApp / dmworkbase 的 download utils。
   * 不传时下载按钮被隐藏。
   */
  onDownload?: (item: MatterOutput) => void;
  /**
   * 来源群成员关系查询。由调用方根据 myGroupNos + matter.channels 注入。
   * 不传时所有行都按 "已加入" 处理 (向后兼容, 不影响独立预览场景)。
   *
   * 用户不在源群时, "来源群" 列显示遮罩 + "不在群" 徽章, 跟关联群聊 tab 一致。
   * 注: 这是 UI 层的隐私防御 (defense-in-depth) — 后端 access policy 已经
   * 把 outputs 限制成 creator/assignees/participants, 这里只是不让创建者看到
   * "事项关联了哪些他没加入的群" 的二阶信息。
   */
  getChannelMembership?: (
    sourceChannelId?: string,
  ) => OutputChannelMembership;
}

// ─── Component ──────────────────────────────────────────

const OutputsPanel: React.FC<OutputsPanelProps> = ({
  outputs,
  loading,
  hasMore,
  query = "",
  error,
  onLoadMore,
  onSearch,
  onRetry,
  renderAvatar,
  onPreview,
  onDownload,
  getChannelMembership,
}) => {
  const { t } = useI18n();
  const [searchValue, setSearchValue] = useState(query);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 把外部 query 同步回输入框 (matter 切换时 panel 会清空 query 来重置)。
  // 注: 用户正在输入时, 外部 query 已经是 trim 过的值, 直接覆盖会吃掉
  // 用户输入的前后空格。所以只在 trimmed 不匹配时才覆盖, 让本地输入态
  // 保留用户的原始空格不被 round-trip 撞掉 (review #97 yujiawei P2-3)。
  useEffect(() => {
    setSearchValue((prev) => (prev.trim() === query ? prev : query));
  }, [query]);

  // 当 onSearch / query 变化时 (典型场景: 父组件 matter 切换重建了
  // handleOutputsSearch callback), 清掉 pending debounce timer, 防止
  // 旧 matter 的搜索词漏给新 matter (review #97 round-5 Jerry-Xin
  // blocking — stale debounced search)。
  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [onSearch, query]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchValue(val);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        onSearch?.(val.trim());
      }, 300);
    },
    [onSearch],
  );

  const handlePreview = useCallback(
    (e: React.MouseEvent, item: MatterOutput) => {
      e.preventDefault();
      e.stopPropagation();
      onPreview?.(item);
    },
    [onPreview],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent, item: MatterOutput) => {
      e.preventDefault();
      e.stopPropagation();
      onDownload?.(item);
    },
    [onDownload],
  );

  const isEmpty = outputs.length === 0 && !loading;
  const emptyText = query ? t("todo.outputs.emptySearch") : t("todo.outputs.emptyDefault");

  return (
    <div className="wk-outputs">
      {/* 搜索栏 (Figma node 1411:8366) */}
      {onSearch && (
        <div className="wk-outputs__search">
          <svg
            className="wk-outputs__search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M7.333 12.667a5.333 5.333 0 100-10.667 5.333 5.333 0 000 10.667zM14 14l-2.9-2.9"
              stroke="currentColor"
              strokeWidth="1.33"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            type="text"
            className="wk-outputs__search-input"
            placeholder={t("todo.outputs.searchPlaceholder")}
            aria-label={t("todo.outputs.searchAriaLabel")}
            value={searchValue}
            onChange={handleSearchChange}
          />
        </div>
      )}

      {/* 表格 (Figma: 6列) */}
      <div className="wk-outputs__table" role="table">
        {/* 表头 */}
        <div className="wk-outputs__thead" role="row">
          <div className="wk-outputs__th wk-outputs__col-title" role="columnheader">
            {t("todo.outputs.column.title")}
          </div>
          <div className="wk-outputs__th wk-outputs__col-desc" role="columnheader">
            {t("todo.outputs.column.description")}
          </div>
          <div className="wk-outputs__th wk-outputs__col-sender" role="columnheader">
            {t("todo.outputs.column.sender")}
          </div>
          <div className="wk-outputs__th wk-outputs__col-channel" role="columnheader">
            {t("todo.outputs.column.sourceGroup")}
          </div>
          <div className="wk-outputs__th wk-outputs__col-time" role="columnheader">
            {t("todo.outputs.column.sentAt")}
          </div>
          <div className="wk-outputs__th wk-outputs__col-actions" role="columnheader">
            {t("todo.outputs.column.actions")}
          </div>
        </div>

        {/* 表体 */}
        {error ? (
          <div className="wk-outputs__empty" role="alert">
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.4"
              aria-hidden="true"
            >
              <path d="M20 5l16 28H4L20 5z" />
              <path d="M20 15v8" />
              <circle cx="20" cy="27" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            <span>{error}</span>
            {onRetry && (
              <button type="button" className="wk-outputs__load-more" onClick={onRetry}>
                {t("todo.outputs.retry")}
              </button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="wk-outputs__empty">
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.4"
              aria-hidden="true"
            >
              <path d="M10 5h12l10 10v20a2.5 2.5 0 01-2.5 2.5h-19A2.5 2.5 0 018 35V7.5A2.5 2.5 0 0110.5 5z" />
              <path d="M22 5v8a2 2 0 002 2h8" />
            </svg>
            <span>{emptyText}</span>
          </div>
        ) : (
          outputs.map((item) => {
            return (
              <div key={item.id} className="wk-outputs__row" role="row">
                {/* 标题: 缩略图 + 文件名 + 大小 */}
                <div className="wk-outputs__td wk-outputs__col-title" role="cell">
                  <FileThumbnail
                    fileName={item.file_name}
                    mimeType={item.mime_type}
                  />
                  <div className="wk-outputs__title-meta">
                    <div
                      className="wk-outputs__file-name"
                      title={item.file_name || ""}
                    >
                      {item.file_name || t("todo.outputs.unnamedFile")}
                    </div>
                    <div className="wk-outputs__file-size">
                      {/*
                        占位符仅用于 null/undefined (后端没给), 0 字节是
                        合法值, 应展示 "0 B" (review #97 round-5
                        Jerry-Xin suggestion)。
                      */}
                      {item.file_size != null
                        ? formatFileSize(item.file_size)
                        : "—"}
                    </div>
                  </div>
                </div>

                {/* 描述: 最多2行截断 */}
                <div
                  className="wk-outputs__td wk-outputs__col-desc"
                  role="cell"
                  title={item.description || ""}
                >
                  <span className="wk-outputs__desc-text">
                    {item.description || ""}
                  </span>
                </div>

                {/* 发送人: 头像 + 姓名 */}
                <div className="wk-outputs__td wk-outputs__col-sender" role="cell">
                  <div className="wk-outputs__user">
                    {renderAvatar ? (
                      renderAvatar(item.sender_uid, 20)
                    ) : (
                      <div className="wk-outputs__user-avatar-fallback">
                        {item.sender_uname?.slice(0, 1) || "?"}
                      </div>
                    )}
                    <span className="wk-outputs__user-name" title={item.sender_uname}>
                      {item.sender_uname}
                    </span>
                  </div>
                </div>

                {/* 来源群: #群名 (不在群时遮罩 + 不在群徽章) */}
                <div className="wk-outputs__td wk-outputs__col-channel" role="cell">
                  {(() => {
                    const m = getChannelMembership?.(item.source_channel_id);
                    const loadingMembership = m?.loading ?? false;
                    const isMember = m?.isMember ?? true;
                    if (loadingMembership) {
                      return (
                        <span
                          className="wk-outputs__channel-name--skeleton"
                          role="status"
                          aria-label={t("todo.outputs.loadingMembership")}
                        >
                          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                        </span>
                      );
                    }
                    if (!isMember && item.source_channel_name) {
                      return (
                        <span className="wk-outputs__channel-blocked">
                          <span
                            className="wk-outputs__channel-name--blur"
                            title={t("todo.outputs.notInGroupTitle")}
                            aria-label={t("todo.outputs.groupNameHidden")}
                          >
                            ████
                          </span>
                          <span className="wk-outputs__not-member-badge">
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              aria-hidden="true"
                            >
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            {t("todo.outputs.notInGroup")}
                          </span>
                        </span>
                      );
                    }
                    return (
                      <span
                        className="wk-outputs__channel-name"
                        title={item.source_channel_name || ""}
                      >
                        {item.source_channel_name
                          ? `#${item.source_channel_name}`
                          : "—"}
                      </span>
                    );
                  })()}
                </div>

                {/* 发送时间: YYYY-MM-DD HH:mm:ss */}
                <div className="wk-outputs__td wk-outputs__col-time" role="cell">
                  <span className="wk-outputs__time-text">
                    {formatDateTime(item.sent_at)}
                  </span>
                </div>

                {/* 操作: (可选)预览 + (可选)下载 */}
                <div className="wk-outputs__td wk-outputs__col-actions" role="cell">
                  {onPreview && (
                    <button
                      type="button"
                      className="wk-outputs__action-btn"
                      aria-label={t("base.filePreview.preview")}
                      title={t("base.filePreview.preview")}
                      onClick={(e) => handlePreview(e, item)}
                    >
                      <EyeIcon />
                    </button>
                  )}
                  {onDownload && (
                    <button
                      type="button"
                      className="wk-outputs__action-btn"
                      aria-label={t("base.filePreview.download")}
                      title={t("base.filePreview.download")}
                      onClick={(e) => handleDownload(e, item)}
                    >
                      <DownloadIcon />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* 加载中骨架 (初次加载) */}
        {loading && outputs.length === 0 && (
          <div className="wk-outputs__loading">
            <div className="wk-outputs__skeleton-row" />
            <div className="wk-outputs__skeleton-row" />
            <div className="wk-outputs__skeleton-row" />
          </div>
        )}
      </div>

      {/* 加载更多 */}
      {hasMore && (
        <button
          type="button"
          className="wk-outputs__load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          {loading ? t("todo.outputs.loading") : t("todo.outputs.loadMore")}
        </button>
      )}
    </div>
  );
};

export default OutputsPanel;
export { OutputsPanel };
