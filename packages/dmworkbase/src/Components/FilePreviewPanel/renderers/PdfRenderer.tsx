import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Viewer,
  Worker,
  PageChangeEvent,
  DocumentLoadEvent,
  SpecialZoomLevel,
} from "@react-pdf-viewer/core";
import { thumbnailPlugin } from "@react-pdf-viewer/thumbnail";
import { bookmarkPlugin } from "@react-pdf-viewer/bookmark";
import {
  zoomPlugin,
  RenderZoomInProps,
  RenderZoomOutProps,
} from "@react-pdf-viewer/zoom";
import { pageNavigationPlugin } from "@react-pdf-viewer/page-navigation";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  PanelLeftClose,
  PanelLeft,
  List,
  Image,
} from "lucide-react";
import { BaseRendererProps } from "../types";
import { isFileTooLarge } from "../config";
import FileTooLarge from "./FileTooLarge";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/thumbnail/lib/styles/index.css";
import "@react-pdf-viewer/bookmark/lib/styles/index.css";
import "@react-pdf-viewer/zoom/lib/styles/index.css";
import "@react-pdf-viewer/page-navigation/lib/styles/index.css";
import "./PdfRenderer.css";

export interface PdfRendererProps extends BaseRendererProps {}

/** 侧边栏 Tab 类型 */
type SidebarTab = "thumbnails" | "bookmarks";

// 缩放选项（移除 300%，保留 50%~200%）
const ZOOM_OPTIONS = [
  { label: "适应宽度", value: "PageWidth" },
  { label: "适应页面", value: "PageFit" },
  { label: "实际大小", value: "ActualSize" },
  { label: "50%", value: "0.5" },
  { label: "75%", value: "0.75" },
  { label: "100%", value: "1" },
  { label: "125%", value: "1.25" },
  { label: "150%", value: "1.5" },
  { label: "200%", value: "2" },
];

/**
 * PDF 渲染器
 * 使用 @react-pdf-viewer 实现，支持缩略图、书签目录、缩放、翻页等功能
 *
 * 功能：
 * 1. 缩略图侧边栏（默认展开）
 * 2. 书签目录 Tab（仅当 PDF 包含书签时可用）
 * 3. 页码跳转
 * 4. 缩放控制（50%~200%）
 * 5. 键盘翻页（PageUp/PageDown）
 * 6. 默认适应宽度
 */
const PdfRenderer: React.FC<PdfRendererProps> = ({ file, onError }) => {
  // 文件大小检查（超过 20MB 不渲染）- 必须在所有 hooks 之前
  const isTooLarge = file.size && isFileTooLarge(file.size);

  // 侧边栏状态
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>("thumbnails");
  const [hasBookmarks, setHasBookmarks] = useState(false);

  // 当前页面状态
  const [currentPage, setCurrentPage] = useState(0);
  // 总页数状态
  const [totalPages, setTotalPages] = useState<number | null>(null);
  // 当前缩放比例状态
  const [currentScale, setCurrentScale] = useState(1);
  // 当前缩放模式（数值或特殊级别）
  const [currentZoomMode, setCurrentZoomMode] = useState<string>("PageWidth");
  // 页码输入框的值
  const [pageInputValue, setPageInputValue] = useState<string>("1");
  // 加载状态
  const [isLoading, setIsLoading] = useState(true);

  // 容器 ref，用于键盘事件监听
  const containerRef = useRef<HTMLDivElement>(null);

  // 使用 useRef 确保插件实例在组件生命周期内稳定
  // 不使用 useMemo 是因为 @react-pdf-viewer 插件在 HMR/Strict Mode 下可能有兼容性问题
  const thumbnailPluginRef = useRef(thumbnailPlugin());
  const bookmarkPluginRef = useRef(bookmarkPlugin());
  const zoomPluginRef = useRef(zoomPlugin());
  const pageNavigationPluginRef = useRef(pageNavigationPlugin());

  const thumbnailPluginInstance = thumbnailPluginRef.current;
  const bookmarkPluginInstance = bookmarkPluginRef.current;
  const zoomPluginInstance = zoomPluginRef.current;
  const pageNavigationPluginInstance = pageNavigationPluginRef.current;

  // 从插件中提取组件和方法
  const { Thumbnails } = thumbnailPluginInstance;
  const { Bookmarks } = bookmarkPluginInstance;
  const { ZoomIn: ZoomInButton, ZoomOut: ZoomOutButton } = zoomPluginInstance;
  const { GoToNextPage, GoToPreviousPage, jumpToPage } =
    pageNavigationPluginInstance;

  // 插件数组 - 使用 useRef 确保稳定引用
  const pluginsRef = useRef([
    thumbnailPluginInstance,
    bookmarkPluginInstance,
    zoomPluginInstance,
    pageNavigationPluginInstance,
  ]);
  const plugins = pluginsRef.current;

  // 文档加载完成监听器
  const handleDocumentLoad = useCallback((e: DocumentLoadEvent) => {
    setTotalPages(e.doc.numPages);
    setIsLoading(false);

    // 检查 PDF 是否包含书签
    e.doc
      .getOutline()
      .then((outline) => {
        setHasBookmarks(Array.isArray(outline) && outline.length > 0);
      })
      .catch(() => {
        // 获取书签失败时默认无书签
        setHasBookmarks(false);
      });
  }, []);

  // 页面变化监听器
  const handlePageChange = useCallback((e: PageChangeEvent) => {
    setCurrentPage(e.currentPage);
    setPageInputValue(String(e.currentPage + 1));
  }, []);

  // 处理缩放模式变化
  const handleZoomChange = useCallback(
    (value: string) => {
      if (
        value === "PageFit" ||
        value === "PageWidth" ||
        value === "ActualSize"
      ) {
        const specialLevel =
          SpecialZoomLevel[value as keyof typeof SpecialZoomLevel];
        zoomPluginInstance.zoomTo(specialLevel);
        setCurrentZoomMode(value);
      } else {
        const scale = parseFloat(value);
        zoomPluginInstance.zoomTo(scale);
        setCurrentScale(scale);
        setCurrentZoomMode(value);
      }
    },
    [zoomPluginInstance]
  );

  // 处理页码输入框变化
  const handlePageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPageInputValue(e.target.value);
    },
    []
  );

  // 处理页码输入框回车键
  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const pageNumber = parseInt(pageInputValue, 10);
        if (
          !isNaN(pageNumber) &&
          pageNumber >= 1 &&
          totalPages &&
          pageNumber <= totalPages
        ) {
          jumpToPage(pageNumber - 1);
        } else {
          setPageInputValue(String(currentPage + 1));
        }
      }
    },
    [pageInputValue, totalPages, currentPage, jumpToPage]
  );

  // 处理输入框失去焦点
  const handlePageInputBlur = useCallback(() => {
    const pageNumber = parseInt(pageInputValue, 10);
    if (
      !isNaN(pageNumber) &&
      pageNumber >= 1 &&
      totalPages &&
      pageNumber <= totalPages
    ) {
      jumpToPage(pageNumber - 1);
    } else {
      setPageInputValue(String(currentPage + 1));
    }
  }, [pageInputValue, totalPages, currentPage, jumpToPage]);

  // 键盘翻页处理
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 检查是否在输入框中
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "PageDown" || e.key === "ArrowDown") {
        e.preventDefault();
        if (totalPages && currentPage < totalPages - 1) {
          jumpToPage(currentPage + 1);
        }
      } else if (e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault();
        if (currentPage > 0) {
          jumpToPage(currentPage - 1);
        }
      }
    },
    [currentPage, totalPages, jumpToPage]
  );

  // 绑定键盘事件
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 使容器可以接收键盘事件
    container.tabIndex = 0;
    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  // 获取当前缩放显示文本
  const getZoomDisplayText = useCallback(() => {
    if (currentZoomMode === "PageFit") return "适应页面";
    if (currentZoomMode === "PageWidth") return "适应宽度";
    if (currentZoomMode === "ActualSize") return "实际大小";
    return `${Math.round(currentScale * 100)}%`;
  }, [currentZoomMode, currentScale]);

  // PDF Worker URL - 使用本地路径避免 CSP 阻止外部 CDN
  const workerUrl = "/pdfjs/pdf.worker.min.js";

  // 文件大小检查（超过 20MB 不渲染）
  if (isTooLarge) {
    return (
      <FileTooLarge
        fileName={file.name}
        fileSize={file.size!}
        fileUrl={file.url}
      />
    );
  }

  if (!file.url) {
    return (
      <div className="wk-file-preview-pdf-renderer__error">
        <span>无法加载 PDF 文件</span>
      </div>
    );
  }

  return (
    <Worker workerUrl={workerUrl}>
      <div
        className="wk-file-preview-pdf-renderer"
        ref={containerRef}
        tabIndex={0}
      >
        {/* 工具栏 */}
        <div className="wk-file-preview-pdf-renderer__toolbar">
          {/* 侧边栏切换按钮 */}
          <button
            className="wk-file-preview-pdf-renderer__toolbar-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "隐藏侧边栏" : "显示侧边栏"}
          >
            {isSidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeft size={18} />
            )}
          </button>

          <div className="wk-file-preview-pdf-renderer__toolbar-divider" />

          {/* 缩放控制 */}
          <ZoomOutButton>
            {(props: RenderZoomOutProps) => (
              <button
                className="wk-file-preview-pdf-renderer__toolbar-btn"
                onClick={props.onClick}
                title="缩小"
              >
                <ZoomOut size={18} />
              </button>
            )}
          </ZoomOutButton>

          <ZoomInButton>
            {(props: RenderZoomInProps) => (
              <button
                className="wk-file-preview-pdf-renderer__toolbar-btn"
                onClick={props.onClick}
                title="放大"
              >
                <ZoomIn size={18} />
              </button>
            )}
          </ZoomInButton>

          <select
            className="wk-file-preview-pdf-renderer__zoom-select"
            value={currentZoomMode}
            onChange={(e) => handleZoomChange(e.target.value)}
          >
            {ZOOM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="wk-file-preview-pdf-renderer__toolbar-divider" />

          {/* 页面导航 */}
          <GoToPreviousPage>
            {(props) => (
              <button
                className={`wk-file-preview-pdf-renderer__toolbar-btn ${
                  props.isDisabled
                    ? "wk-file-preview-pdf-renderer__toolbar-btn--disabled"
                    : ""
                }`}
                onClick={props.isDisabled ? undefined : props.onClick}
                title="上一页 (PageUp)"
                disabled={props.isDisabled}
              >
                <ChevronLeft size={18} />
              </button>
            )}
          </GoToPreviousPage>

          <GoToNextPage>
            {(props) => (
              <button
                className={`wk-file-preview-pdf-renderer__toolbar-btn ${
                  props.isDisabled
                    ? "wk-file-preview-pdf-renderer__toolbar-btn--disabled"
                    : ""
                }`}
                onClick={props.isDisabled ? undefined : props.onClick}
                title="下一页 (PageDown)"
                disabled={props.isDisabled}
              >
                <ChevronRight size={18} />
              </button>
            )}
          </GoToNextPage>

          <div className="wk-file-preview-pdf-renderer__page-nav">
            <input
              type="text"
              className="wk-file-preview-pdf-renderer__page-input"
              value={pageInputValue}
              onChange={handlePageInputChange}
              onKeyDown={handlePageInputKeyDown}
              onBlur={handlePageInputBlur}
              title="跳转到页面"
            />
            <span className="wk-file-preview-pdf-renderer__page-total">
              / {totalPages || "-"}
            </span>
          </div>
        </div>

        {/* 主内容区域 */}
        <div className="wk-file-preview-pdf-renderer__content">
          {/* 侧边栏 */}
          {isSidebarOpen && (
            <div className="wk-file-preview-pdf-renderer__sidebar">
              {/* Tab 切换 */}
              <div className="wk-file-preview-pdf-renderer__sidebar-tabs">
                <button
                  className={`wk-file-preview-pdf-renderer__sidebar-tab ${
                    activeTab === "thumbnails"
                      ? "wk-file-preview-pdf-renderer__sidebar-tab--active"
                      : ""
                  }`}
                  onClick={() => setActiveTab("thumbnails")}
                  title="缩略图"
                >
                  <Image size={16} />
                  <span>缩略图</span>
                </button>
                <button
                  className={`wk-file-preview-pdf-renderer__sidebar-tab ${
                    activeTab === "bookmarks"
                      ? "wk-file-preview-pdf-renderer__sidebar-tab--active"
                      : ""
                  } ${
                    !hasBookmarks
                      ? "wk-file-preview-pdf-renderer__sidebar-tab--disabled"
                      : ""
                  }`}
                  onClick={() => hasBookmarks && setActiveTab("bookmarks")}
                  disabled={!hasBookmarks}
                  title={hasBookmarks ? "书签目录" : "此 PDF 无书签"}
                >
                  <List size={16} />
                  <span>目录</span>
                </button>
              </div>

              {/* Tab 内容 */}
              <div className="wk-file-preview-pdf-renderer__sidebar-content">
                {activeTab === "thumbnails" && (
                  <div className="wk-file-preview-pdf-renderer__thumbnails">
                    <Thumbnails />
                  </div>
                )}
                {activeTab === "bookmarks" && hasBookmarks && (
                  <div className="wk-file-preview-pdf-renderer__bookmarks">
                    <Bookmarks />
                  </div>
                )}
                {activeTab === "bookmarks" && !hasBookmarks && (
                  <div className="wk-file-preview-pdf-renderer__no-bookmarks">
                    <span>此 PDF 文件没有书签</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PDF 查看器 */}
          <div className="wk-file-preview-pdf-renderer__viewer">
            {isLoading && (
              <div className="wk-file-preview-pdf-renderer__loading">
                <div className="wk-file-preview-pdf-renderer__spinner" />
                <span>加载中...</span>
              </div>
            )}
            <Viewer
              fileUrl={file.url}
              plugins={plugins}
              onDocumentLoad={handleDocumentLoad}
              onPageChange={handlePageChange}
              defaultScale={SpecialZoomLevel.PageWidth}
              characterMap={{
                url: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
                isCompressed: true,
              }}
              renderError={(error) => (
                <div className="wk-file-preview-pdf-renderer__error">
                  <span>PDF 加载失败</span>
                  <span className="wk-file-preview-pdf-renderer__error-detail">
                    {error.message || "请检查文件是否有效"}
                  </span>
                </div>
              )}
            />
          </div>
        </div>
      </div>
    </Worker>
  );
};

export default PdfRenderer;
export { PdfRenderer };
