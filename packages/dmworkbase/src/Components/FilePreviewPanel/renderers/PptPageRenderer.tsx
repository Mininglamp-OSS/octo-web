/**
 * PPT 页面预览组件
 *
 * 用于展示 PPT 页面内容，支持代码视图和预览视图切换
 * 设计风格: Refined Presentation Mode
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Code2, Eye, AlertCircle } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import HtmlIframeRenderer from "./HtmlIframeRenderer";
import { useI18n } from "../../../i18n";
import { Loading } from "@octo/ui";
import "./PptRenderer.css";

/** PPT 页面内容类型 */
export type PptPageContent = { content: string } | { url: string };

/** 视图类型 */
type ViewType = "preview" | "code";

/** iframe 尺寸 */
interface IframeSize {
  width: number;
  height: number;
}

/** PPT 单页渲染器属性 */
export interface PptPageRendererProps extends PptPageContent {
  /** 页面索引 (从1开始) */
  index: number;
  /** 总页数 */
  total: number;
  /** 是否仅预览模式（隐藏切换按钮） */
  previewOnly?: boolean;
  /** 页面唯一ID */
  pageId?: string;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * PPT 单页渲染器
 * 支持代码视图和预览视图切换
 */
const PptPageRenderer: React.FC<PptPageRendererProps> = (props) => {
  const { t } = useI18n();
  const {
    index,
    total,
    previewOnly = false,
    pageId: pageIdProp,
    className,
    style,
    ...contentProps
  } = props;

  // 判断内容来源
  const hasContent = "content" in contentProps;
  const hasUrl = "url" in contentProps;

  // 生成唯一 ID
  const pageId = useMemo(
    () => pageIdProp || `ppt-page-${index}-${Date.now()}`,
    [pageIdProp, index]
  );

  // 状态
  const [activeView, setActiveView] = useState<ViewType>("preview");
  const [iframeSize, setIframeSize] = useState<IframeSize>({
    width: 1280,
    height: 720,
  });
  const [iframeScale, setIframeScale] = useState<number>(1);
  const [content, setContent] = useState<string>(
    hasContent ? (contentProps as { content: string }).content : ""
  );
  const [loading, setLoading] = useState<boolean>(hasUrl);
  const [error, setError] = useState<string | null>(null);

  // 引用
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useRef<number>(0);
  const iframeSizeRef = useRef<IframeSize>(iframeSize);

  // 从 URL 加载内容
  useEffect(() => {
    if (hasUrl) {
      const fetchContent = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await fetch(
            (contentProps as { url: string }).url
          );
          if (!response.ok) {
            throw new Error(t("base.filePreview.loadFailed"));
          }
          const text = await response.text();
          setContent(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("base.filePreview.loadFailed"));
        } finally {
          setLoading(false);
        }
      };
      fetchContent();
    }
  }, [hasUrl, (contentProps as { url?: string }).url, t]);

  // 监听 iframe 高度消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event?.data?.type === "ppt_page_size") {
        const { pageId: messagePageId, height, width } = event.data;
        if (messagePageId !== pageId) return;

        const newSize = { height, width };
        iframeSizeRef.current = newSize;
        setIframeSize(newSize);

        if (containerWidth.current) {
          setIframeScale(containerWidth.current / width);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pageId]);

  // 监听容器宽度变化
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
      if (containerRef.current) {
        containerWidth.current = containerRef.current.offsetWidth;
        if (iframeSizeRef.current.width && containerWidth.current) {
          setIframeScale(containerWidth.current / iframeSizeRef.current.width);
        }
      }
    };

    updateScale();

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // 注入高度自适应脚本
  const injectResizeScript = useCallback(
    (htmlContent: string): string => {
      if (!htmlContent) return htmlContent;

      const resizeScript = `
        <style>body { overflow: hidden; margin: 0; }</style>
        <script>
          let lastHeight = 0;
          function sendSize() {
            const height = document.body.scrollHeight || 720;
            const width = document.body.scrollWidth || 1280;
            if (height !== lastHeight) {
              lastHeight = height;
              window.parent.postMessage({
                type: 'ppt_page_size',
                pageId: '${pageId}',
                height,
                width
              }, '*');
            }
          }
          window.addEventListener('load', sendSize);
          new MutationObserver(() => setTimeout(sendSize, 50))
            .observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
        </script>
      `;

      // 在 </body> 前插入脚本
      if (htmlContent.includes("</body>")) {
        return htmlContent.replace("</body>", `${resizeScript}</body>`);
      }
      // 如果没有 body 标签，追加到末尾
      return htmlContent + resizeScript;
    },
    [pageId]
  );

  // 渲染加载状态
  const renderLoading = () => (
    <div className="wk-file-preview-ppt-page__loading">
      <Loading text={t("base.filePreview.loading")} layout="vertical" />
    </div>
  );

  // 渲染错误状态
  const renderError = () => (
    <div className="wk-file-preview-ppt-page__error">
      <AlertCircle className="wk-file-preview-ppt-page__error-icon" />
      <span className="wk-file-preview-ppt-page__error-text">{error}</span>
    </div>
  );

  // 渲染代码视图
  const renderCodeView = () => {
    if (!content) {
      return null;
    }

    return (
      <div
        className="wk-file-preview-ppt-page__code-wrapper"
        style={{ display: activeView === "code" ? "flex" : "none" }}
      >
        {/* 代码窗口装饰 */}
        <div className="wk-file-preview-ppt-page__code-header">
          <span className="wk-file-preview-ppt-page__code-dot wk-file-preview-ppt-page__code-dot--red" />
          <span className="wk-file-preview-ppt-page__code-dot wk-file-preview-ppt-page__code-dot--yellow" />
          <span className="wk-file-preview-ppt-page__code-dot wk-file-preview-ppt-page__code-dot--green" />
          <span className="wk-file-preview-ppt-page__code-label">HTML</span>
        </div>
        <div className="wk-file-preview-ppt-page__code">
          <SyntaxHighlighter
            language="html"
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              padding: 16,
              background: "transparent",
              fontSize: 13,
              lineHeight: 1.6,
              height: "100%",
              overflow: "auto",
            }}
            wrapLongLines
          >
            {content}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  };

  // 渲染预览视图（始终渲染，用 display 控制显示）
  const renderPreviewView = () => {
    return (
      <div
        className="wk-file-preview-ppt-page__preview"
        style={{ display: activeView === "preview" ? "flex" : "none" }}
      >
        <div
          className="wk-file-preview-ppt-page__preview-container"
          style={{
            height: iframeSize.height ? iframeSize.height * iframeScale : "auto",
          }}
        >
          <HtmlIframeRenderer
            srcDoc={injectResizeScript(content)}
            iframeStyle={{
              width: iframeSize.width,
              height: iframeSize.height,
              transform: `scale(${iframeScale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    );
  };

  // 渲染视图切换器
  const renderViewSwitcher = () => (
    <div className="wk-file-preview-ppt-page__view-switcher">
      <button
        className={`wk-file-preview-ppt-page__view-btn ${
          activeView === "preview" ? "wk-file-preview-ppt-page__view-btn--active" : ""
        }`}
        onClick={() => setActiveView("preview")}
      >
        <Eye className="wk-file-preview-ppt-page__view-btn-icon" />
      </button>
      <span className="wk-file-preview-ppt-page__view-separator" />
      <button
        className={`wk-file-preview-ppt-page__view-btn ${
          activeView === "code" ? "wk-file-preview-ppt-page__view-btn--active" : ""
        }`}
        onClick={() => setActiveView("code")}
      >
        <Code2 className="wk-file-preview-ppt-page__view-btn-icon" />
      </button>
    </div>
  );

  // 渲染页码信息
  const renderPageInfo = () => (
    <div className="wk-file-preview-ppt-page__page-info">
      <span className="wk-file-preview-ppt-page__page-badge">
        <span className="wk-file-preview-ppt-page__page-current">{index}</span>
        <span className="wk-file-preview-ppt-page__page-separator">/</span>
        <span className="wk-file-preview-ppt-page__page-total">{total}</span>
      </span>
    </div>
  );

  // 预览模式简化渲染
  if (previewOnly) {
    return (
      <div
        ref={containerRef}
        className={`wk-file-preview-ppt-page wk-file-preview-ppt-page--preview-only ${className || ""}`}
        style={style}
      >
        {loading && renderLoading()}
        {error && renderError()}
        {!loading && !error && (
          <div className="wk-file-preview-ppt-page__preview">
            <div
              className="wk-file-preview-ppt-page__preview-container"
              style={{
                height: iframeSize.height ? iframeSize.height * iframeScale : "auto",
              }}
            >
              <HtmlIframeRenderer
                srcDoc={injectResizeScript(content)}
                iframeStyle={{
                  width: iframeSize.width,
                  height: iframeSize.height,
                  transform: `scale(${iframeScale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`wk-file-preview-ppt-page ${className || ""}`}
      style={style}
    >
      {/* 顶部导航栏 */}
      <div className="wk-file-preview-ppt-page__header">
        {/* 视图切换按钮 */}
        {renderViewSwitcher()}
        {/* 页码信息 */}
        {renderPageInfo()}
      </div>

      {/* 内容区域 */}
      <div className="wk-file-preview-ppt-page__content">
        {loading && renderLoading()}
        {error && renderError()}
        {!loading && !error && (
          <>
            {renderCodeView()}
            {renderPreviewView()}
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(PptPageRenderer);
export { PptPageRenderer };
