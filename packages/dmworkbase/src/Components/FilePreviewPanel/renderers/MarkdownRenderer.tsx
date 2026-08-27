import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { BaseRendererProps } from "../types";
import { isFileTooLarge, FILE_SIZE_THRESHOLD, getRenderMode } from "../config";
import { useFileContent } from "../hooks/useFileContent";
import FileTooLarge from "./FileTooLarge";
import MarkdownContent from "../../../Messages/Text/MarkdownContent";
import MarkdownSourceView from "./MarkdownSourceView";
import MarkdownToc, { shouldShowToc, extractTocItems } from "./MarkdownToc";
import { useI18n } from "../../../i18n";
import "./MarkdownRenderer.css";

/** 超过此大小的 Markdown 自动使用源码模式（性能考虑） */
const MARKDOWN_PREVIEW_LIMIT = FILE_SIZE_THRESHOLD.MARKDOWN_PREVIEW;

export interface MarkdownRendererProps extends BaseRendererProps {
  /** 外部控制的视图模式 */
  viewMode?: "preview" | "source";
  /** 视图模式变化回调 */
  onViewModeChange?: (mode: "preview" | "source") => void;
  /** TOC 是否展开 */
  isTocOpen?: boolean;
  /** TOC 展开/收起回调 */
  onTocToggle?: () => void;
  /** TOC 可用状态变化回调（当内容加载后判断是否满足 h2 ≥ 3 条件） */
  onTocAvailableChange?: (available: boolean) => void;
}

/**
 * 带取消功能的节流函数
 */
function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = ((...args: unknown[]) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  }) as T & { cancel: () => void };

  // 暴露 cancel 方法用于清理
  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return throttled;
}

/**
 * Markdown 渲染器
 * 支持 md, markdown 格式
 *
 * 功能：
 * 1. 预览模式：GFM 渲染，支持表格、任务列表、代码块语法高亮
 * 2. 源码模式：Markdown 语法高亮 + 行号
 * 3. 目录 (TOC)：h2 ≥ 3 时显示，支持 h2/h3 层级，点击跳转
 * 4. 视图记忆：不跨文件，每次打开默认预览模式
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  file,
  onError,
  viewMode: externalViewMode,
  onViewModeChange,
  isTocOpen: externalTocOpen,
  onTocToggle,
  onTocAvailableChange,
}) => {
  const { t } = useI18n();
  // 内部状态（当外部未控制时使用）
  const [internalViewMode, setInternalViewMode] = useState<
    "preview" | "source"
  >("preview");
  const [internalTocOpen, setInternalTocOpen] = useState(false);
  const [activeTocId, setActiveTocId] = useState<string | undefined>();

  // 内容区域引用（用于滚动定位）
  const contentRef = useRef<HTMLDivElement>(null);

  // 确定实际使用的状态
  const viewMode = externalViewMode ?? internalViewMode;
  const isTocOpen = externalTocOpen ?? internalTocOpen;

  // 加载文件内容
  const { content, loading, error, reload } = useFileContent({
    url: file.url,
  });

  // 检测是否为大文件（超过限制强制使用源码模式）
  // 优先使用 file.size（服务器已提供），避免额外内存分配
  const isLargeFile = useMemo(() => {
    if (file.size) {
      return file.size > MARKDOWN_PREVIEW_LIMIT;
    }
    // 回退：使用 content.length 粗略判断（对 ASCII 为主的 Markdown 够用）
    if (!content) return false;
    return content.length > MARKDOWN_PREVIEW_LIMIT;
  }, [file.size, content]);

  // 大文件强制使用源码模式
  const effectiveViewMode = isLargeFile ? "source" : viewMode;

  // 计算内容大小（用于源码模式的分级渲染）
  const contentSize = useMemo(() => {
    if (file.size) return file.size;
    return content ? new Blob([content]).size : 0;
  }, [file.size, content]);

  // 源码模式的渲染模式（highlight / plain / too-large）
  const sourceRenderMode = useMemo(
    () => getRenderMode(contentSize),
    [contentSize]
  );

  // 提取 TOC 项目（只计算一次）
  const tocItems = useMemo(() => {
    if (!content) return [];
    return extractTocItems(content);
  }, [content]);

  // 是否应该显示 TOC（条件：预览模式 + h2 ≥ 3 + 非大文件）
  const showTocButton = useMemo(() => {
    if (effectiveViewMode !== "preview" || !content) return false;
    // 使用已计算的 tocItems，避免重复解析
    const h2Count = tocItems.filter((item) => item.level === 2).length;
    return h2Count >= 3;
  }, [tocItems, effectiveViewMode, content]);

  // 通知外部 TOC 可用状态变化
  useEffect(() => {
    if (!content) return;
    const h2Count = tocItems.filter((item) => item.level === 2).length;
    const available = effectiveViewMode === "preview" && h2Count >= 3;
    onTocAvailableChange?.(available);
  }, [tocItems, effectiveViewMode, content, onTocAvailableChange]);

  // 处理视图模式切换
  const handleViewModeChange = useCallback(
    (mode: "preview" | "source") => {
      if (onViewModeChange) {
        onViewModeChange(mode);
      } else {
        setInternalViewMode(mode);
      }
      // 源码模式时关闭 TOC（大文件强制源码模式不触发）
      if ((mode === "source" || isLargeFile) && isTocOpen) {
        if (onTocToggle) {
          onTocToggle();
        } else {
          setInternalTocOpen(false);
        }
      }
    },
    [onViewModeChange, isTocOpen, onTocToggle, isLargeFile]
  );

  // 处理 TOC 展开/收起
  const handleTocToggle = useCallback(() => {
    if (onTocToggle) {
      onTocToggle();
    } else {
      setInternalTocOpen(!internalTocOpen);
    }
  }, [onTocToggle, internalTocOpen]);

  // 处理 TOC 项目点击（滚动到对应位置）
  // 使用标题文本内容匹配，避免索引不一致的问题
  const handleTocItemClick = useCallback(
    (id: string) => {
      setActiveTocId(id);

      // 在内容区域中查找对应的标题元素
      const contentEl = contentRef.current;
      if (!contentEl) return;

      // 找到目标 TOC 项
      const targetTocItem = tocItems.find((item) => item.id === id);
      if (!targetTocItem) return;

      // 通过标题文本内容匹配 DOM 元素，更可靠
      const headings = contentEl.querySelectorAll("h2, h3");
      let targetEl: Element | null = null;

      for (const heading of headings) {
        // 规范化文本内容进行比较（去除多余空白）
        const headingText = (heading.textContent || "")
          .trim()
          .replace(/\s+/g, " ");
        const tocText = targetTocItem.text.trim().replace(/\s+/g, " ");

        if (headingText === tocText) {
          targetEl = heading;
          break;
        }
      }

      // 滚动到目标位置
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [tocItems]
  );

  // 监听滚动，更新激活的 TOC 项（节流处理）
  useEffect(() => {
    if (!isTocOpen || effectiveViewMode !== "preview" || !content) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;

    // 构建标题文本到 TOC ID 的映射，避免每次滚动时重复查找
    const textToIdMap = new Map<string, string>();
    for (const item of tocItems) {
      const normalizedText = item.text.trim().replace(/\s+/g, " ");
      textToIdMap.set(normalizedText, item.id);
    }

    // 节流的滚动处理函数
    const handleScroll = throttle(() => {
      const headings = contentEl.querySelectorAll("h2, h3");
      const offset = 50; // 偏移量，提前高亮

      let currentId: string | undefined;

      headings.forEach((heading) => {
        const rect = heading.getBoundingClientRect();
        const containerRect = contentEl.getBoundingClientRect();
        const relativeTop = rect.top - containerRect.top;

        if (relativeTop < offset) {
          // 通过文本内容查找对应的 TOC ID
          const headingText = (heading.textContent || "")
            .trim()
            .replace(/\s+/g, " ");
          const matchedId = textToIdMap.get(headingText);
          if (matchedId) {
            currentId = matchedId;
          }
        }
      });

      setActiveTocId((prevId) => {
        if (currentId !== prevId) {
          return currentId;
        }
        return prevId;
      });
    }, 100); // 100ms 节流

    contentEl.addEventListener("scroll", handleScroll, { passive: true });

    // 清理：移除事件监听器并取消节流定时器
    return () => {
      contentEl.removeEventListener("scroll", handleScroll);
      handleScroll.cancel();
    };
  }, [isTocOpen, effectiveViewMode, content, tocItems]);

  // 使用 useEffect 通知错误，避免在渲染阶段调用外部回调
  useEffect(() => {
    if (error) {
      onError?.(error);
    }
  }, [error, onError]);

  // 文件大小检查（超过 20MB 不渲染）- 移到 hooks 之后
  if (file.size && isFileTooLarge(file.size)) {
    return (
      <FileTooLarge
        fileName={file.name}
        fileSize={file.size}
        fileUrl={file.url}
      />
    );
  }

  // 加载状态
  if (loading) {
    return (
      <div className="wk-file-preview-markdown-renderer wk-file-preview-markdown-renderer--loading">
        <div className="wk-file-preview-markdown-renderer__spinner" />
        <span className="wk-file-preview-markdown-renderer__message">
          {t("base.filePreview.loading")}
        </span>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="wk-file-preview-markdown-renderer wk-file-preview-markdown-renderer--error">
        <span className="wk-file-preview-markdown-renderer__message">
          {error}
        </span>
        <button
          className="wk-file-preview-markdown-renderer__retry"
          onClick={reload}
        >
          {t("base.filePreview.retry")}
        </button>
      </div>
    );
  }

  // 空内容状态
  if (content === null || content.trim() === "") {
    return (
      <div className="wk-file-preview-markdown-renderer wk-file-preview-markdown-renderer--empty">
        <span className="wk-file-preview-markdown-renderer__message">
          {t("base.filePreview.empty")}
        </span>
      </div>
    );
  }

  return (
    <div className="wk-file-preview-markdown-renderer">
      {/* TOC 侧边栏（仅预览模式显示） */}
      {effectiveViewMode === "preview" && showTocButton && (
        <MarkdownToc
          content={content}
          isOpen={isTocOpen}
          onToggle={handleTocToggle}
          onItemClick={handleTocItemClick}
          activeId={activeTocId}
        />
      )}

      {/* 内容区域 */}
      <div
        className="wk-file-preview-markdown-renderer__content"
        ref={contentRef}
      >
        {/* 大文件提示（强制源码模式时显示） */}
        {isLargeFile && (
          <div className="wk-file-preview-markdown-renderer__large-file-notice">
            {t("base.filePreview.markdown.largeAutoSource")}
          </div>
        )}

        {effectiveViewMode === "preview" ? (
          <div className="wk-file-preview-markdown-renderer__preview">
            <MarkdownContent content={content} enableMath />
          </div>
        ) : sourceRenderMode === "too-large" ? (
          /* 源码超过 PLAIN_TEXT 阈值，不预览 */
          <FileTooLarge
            fileName={file.name}
            fileSize={contentSize}
            fileUrl={file.url}
          />
        ) : (
          <MarkdownSourceView content={content} contentSize={contentSize} />
        )}
      </div>
    </div>
  );
};

export default MarkdownRenderer;
export { MarkdownRenderer };

// 导出 TOC 相关函数供外部使用
export { shouldShowToc, extractTocItems } from "./MarkdownToc";
