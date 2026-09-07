import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { Download, ShieldAlert } from "lucide-react";
import { BaseRendererProps } from "../types";
import { isFileTooLarge, getRenderMode, formatFileSize } from "../config";
import { useFileContent } from "../hooks/useFileContent";
import { RendererState } from "./RendererState";
import FileTooLarge from "./FileTooLarge";
import { downloadFile } from "../../../Utils/download";
import { useI18n } from "../../../i18n";
import { Loading } from "@octo/ui";
import "./HtmlRenderer.css";
import "./code-highlight.css";

export interface HtmlRendererProps extends BaseRendererProps {
  /** 视图模式：预览 | 源码 */
  viewMode?: "preview" | "source";
  /** 视图模式变化回调 */
  onViewModeChange?: (mode: "preview" | "source") => void;
}

/**
 * 向 HTML 内容的 <head> 最前面注入 CSP 监听脚本。
 *
 * 由于 sandbox 没有 allow-same-origin，iframe 内部的 CSP 违规事件
 * 不会冒泡到父页面，必须在 iframe 内部监听后通过 postMessage 上报。
 */
function injectCspMonitor(html: string): string {
  // 注入的脚本：监听 iframe 内部 CSP 违规，通过 postMessage 上报父页面
  // 使用 <\/script> 防止注入内容被误解析为闭合标签
  const script =
    `<script data-wk="csp-monitor">(function(){` +
    `document.addEventListener('securitypolicyviolation',function(e){` +
    `var d=e.effectiveDirective||e.violatedDirective||'';` +
    `if(d.indexOf('script-src')!==-1||d.indexOf('connect-src')!==-1){` +
    `window.parent.postMessage({type:'html-csp-violation',directive:d},'*');` +
    `}` +
    `});` +
    `})();<\/script>`;

  // 尽量注入到 <head> 最前面，确保早于其他脚本执行
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + script);
  }
  // 没有 <head> 时注入到 <html> 之后
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + script);
  }
  // 兜底：直接插到最前面
  return script + html;
}

/**
 * HTML 渲染器
 * 使用 iframe 渲染 HTML 文件，支持完整的 HTML 预览
 * 支持 html, htm 格式
 *
 * 功能：
 * 1. 预览模式：iframe 沙箱渲染
 * 2. 源码模式：语法高亮 + 行号
 * 3. 错误自动切源码：iframe 渲染出错时自动切换到源码并显示红色提示条
 * 4. CSP 防护策略：注入脚本检测 iframe 内部 CSP 错误，命中后停止预览并显示提示页
 */
const HtmlRenderer: React.FC<HtmlRendererProps> = ({
  file,
  onError,
  viewMode: externalViewMode,
  onViewModeChange,
}) => {
  const { t } = useI18n();
  // 内部视图模式状态（当外部不传入时使用）
  const [internalViewMode, setInternalViewMode] = useState<
    "preview" | "source"
  >("preview");
  // 实际使用的视图模式
  const viewMode = externalViewMode ?? internalViewMode;

  const [iframeLoading, setIframeLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 脚本执行策略：默认允许脚本，检测到 CSP 错误后降级为禁用脚本
  const [scriptEnabled, setScriptEnabled] = useState(true);
  // 是否因 CSP 降级（用于显示提示）
  const [cspFallback, setCspFallback] = useState(false);

  // 加载 HTML 内容
  const {
    content,
    loading: contentLoading,
    error,
    reload,
  } = useFileContent({
    url: file.url,
  });

  // 切换视图模式
  const handleViewModeChange = useCallback(
    (mode: "preview" | "source") => {
      if (onViewModeChange) {
        onViewModeChange(mode);
      } else {
        setInternalViewMode(mode);
      }
      // 切换到预览模式时清除错误状态
      if (mode === "preview") {
        setRenderError(null);
        setIframeLoading(true);
      }
    },
    [onViewModeChange]
  );

  // 文件变化时重置脚本策略
  useEffect(() => {
    setScriptEnabled(true);
    setCspFallback(false);
  }, [file.url]);

  // 切换到预览模式时重置加载状态
  useEffect(() => {
    if (content && viewMode === "preview") {
      setIframeLoading(true);
    }
  }, [content, viewMode]);

  // iframe 加载完成
  const handleIframeLoad = useCallback(() => {
    setIframeLoading(false);
  }, []);

  // iframe 加载错误
  const handleIframeError = useCallback(() => {
    setIframeLoading(false);
    const errorMsg = t("base.filePreview.html.renderFailedSwitchSource");
    setRenderError(errorMsg);
    handleViewModeChange("source");
    onError?.(errorMsg);
  }, [handleViewModeChange, onError, t]);

  const handleDownload = useCallback(() => {
    void downloadFile(file.url, file.name || "file.html");
  }, [file.name, file.url]);

  // 监听来自 iframe 的 postMessage
  // - html-csp-violation: iframe 内部 CSP 违规，降级为无脚本模式
  // - html-render-error: iframe 内部 JS 运行时错误，切换到源码视图
  //
  // 多实例安全：event.source === iframe.contentWindow 保证只响应自己的 iframe
  useEffect(() => {
    if (viewMode !== "preview" || !content) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      // 只处理来自本实例 iframe 的消息，天然隔离多实例
      if (event.source !== iframe.contentWindow) return;

      if (event.data?.type === "html-csp-violation") {
        console.warn(
          "[HtmlRenderer] CSP violation inside iframe, disable HTML preview.",
          event.data.directive
        );
        setScriptEnabled(false);
        setCspFallback(true);
        setIframeLoading(false);
        return;
      }

      if (event.data?.type === "html-render-error") {
        const errorMsg = t("base.filePreview.html.renderError", {
          values: {
            message:
              event.data.message || t("base.filePreview.html.unknownError"),
          },
        });
        setRenderError(errorMsg);
        handleViewModeChange("source");
        onError?.(errorMsg);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [viewMode, content, handleViewModeChange, onError, t]);

  // 向 srcdoc 注入 CSP 监听脚本。命中 CSP 后不再渲染 iframe，直接显示禁用预览页。
  const srcdocContent = useMemo(() => {
    if (!content) return "";
    return injectCspMonitor(content);
  }, [content]);

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

  // 内容加载中
  if (contentLoading) {
    return <RendererState type="loading" />;
  }

  // 内容加载错误
  if (error) {
    return <RendererState type="error" message={error} onRetry={reload} />;
  }

  // 无内容
  if (!content) {
    return <RendererState type="empty" />;
  }

  // 源码模式
  if (viewMode === "source") {
    // 源码超过 PLAIN_TEXT 阈值，不预览
    if (sourceRenderMode === "too-large") {
      return (
        <FileTooLarge
          fileName={file.name}
          fileSize={contentSize}
          fileUrl={file.url}
        />
      );
    }

    return (
      <div className="wk-file-preview-html-renderer wk-file-preview-html-renderer--source">
        {/* 错误提示条 */}
        {renderError && (
          <div className="wk-file-preview-html-renderer__error-bar">
            <span className="wk-file-preview-html-renderer__error-icon">⚠</span>
            <span className="wk-file-preview-html-renderer__error-text">
              {renderError}
            </span>
            <button
              className="wk-file-preview-html-renderer__retry-preview"
              onClick={() => handleViewModeChange("preview")}
            >
              {t("base.filePreview.html.retryPreview")}
            </button>
          </div>
        )}
        <div className="wk-file-preview-html-renderer__source-container wk-code-highlight-container">
          {sourceRenderMode === "highlight" ? (
            <SyntaxHighlighter
              language="html"
              useInlineStyles={false}
              showLineNumbers
              wrapLines
              lineNumberStyle={{
                minWidth: "3em",
                paddingRight: "1em",
                textAlign: "right",
                userSelect: "none",
              }}
            >
              {content}
            </SyntaxHighlighter>
          ) : (
            <>
              <div className="wk-file-preview-html-renderer__plain-hint">
                {t("base.filePreview.largeFilePlainHintPerf", {
                  values: { size: formatFileSize(contentSize) },
                })}
              </div>
              <pre className="wk-file-preview-html-renderer__plain-source">
                <code>{content}</code>
              </pre>
            </>
          )}
        </div>
      </div>
    );
  }

  // 预览模式：使用 srcdoc 渲染 HTML
  // 安全策略：默认 allow-scripts 且不加 allow-same-origin；命中 CSP 后停止渲染 HTML。
  if (cspFallback) {
    return (
      <div className="wk-file-preview-html-renderer wk-file-preview-html-renderer--preview">
        <div className="wk-file-preview-html-renderer__disabled-preview">
          <div className="wk-file-preview-html-renderer__disabled-icon">
            <ShieldAlert size={48} strokeWidth={1.5} />
          </div>
          <div className="wk-file-preview-html-renderer__disabled-content">
            <h3 className="wk-file-preview-html-renderer__disabled-title">
              {t("base.filePreview.html.safePreviewBlockedTitle")}
            </h3>
            <p className="wk-file-preview-html-renderer__disabled-message">
              {t("base.filePreview.html.safePreviewBlockedMessage")}
            </p>
            <p className="wk-file-preview-html-renderer__disabled-submessage">
              {t("base.filePreview.html.safePreviewBlockedSubmessage")}
            </p>
          </div>
          <div className="wk-file-preview-html-renderer__disabled-actions">
            <button
              className="wk-file-preview-html-renderer__disabled-action"
              onClick={() => handleViewModeChange("source")}
            >
              {t("base.filePreview.html.viewSource")}
            </button>
            <button
              className="wk-file-preview-html-renderer__disabled-action wk-file-preview-html-renderer__disabled-action--primary"
              onClick={handleDownload}
            >
              <Download size={16} />
              <span>{t("base.filePreview.downloadFile")}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wk-file-preview-html-renderer wk-file-preview-html-renderer--preview">
      {iframeLoading && (
        <div className="wk-file-preview-html-renderer__loading-overlay">
          <Loading text={t("base.filePreview.html.rendering")} layout="vertical" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcdocContent}
        className={`wk-file-preview-html-renderer__iframe ${
          iframeLoading ? "wk-file-preview-html-renderer__iframe--hidden" : ""
        }`}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        sandbox={scriptEnabled ? "allow-scripts" : ""}
        title={file.name}
      />
    </div>
  );
};

export default HtmlRenderer;
export { HtmlRenderer };
