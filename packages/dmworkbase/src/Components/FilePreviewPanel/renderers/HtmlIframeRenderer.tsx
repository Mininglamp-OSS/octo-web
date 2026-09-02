/**
 * HTML iframe 渲染器
 *
 * 用于在 iframe 中预览 HTML 内容，支持通过 URL 或 HTML 源代码字符串进行预览
 * 包含加载状态显示，当内容加载完成后自动隐藏加载状态
 */
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from "react";
import { useI18n } from "../../../i18n";
import { Loading } from "@octo/ui";
import "./HtmlIframeRenderer.css";

/**
 * HtmlIframeRenderer 引用接口
 */
export interface HtmlIframeRendererRef {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

/**
 * HtmlIframeRenderer 属性接口
 */
export interface HtmlIframeRendererProps {
  /** URL 方式加载 HTML */
  url?: string;
  /** HTML 源代码字符串 */
  srcDoc?: string;
  /** 加载完成回调 */
  onLoad?: () => void;
  /** iframe 类名 */
  iframeClassName?: string;
  /** iframe 样式 */
  iframeStyle?: React.CSSProperties;
}

/**
 * HTML iframe 渲染器
 * 用于在安全的 iframe 环境中预览 HTML 内容
 * 支持 URL 或 srcDoc 两种方式
 */
const HtmlIframeRenderer = forwardRef<
  HtmlIframeRendererRef,
  HtmlIframeRendererProps
>(({ url, srcDoc, onLoad, iframeClassName, iframeStyle }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [blobUrl, setBlobUrl] = useState<string>();
  const { t } = useI18n();

  // 暴露 iframeRef 给父组件
  useImperativeHandle(ref, () => ({
    iframeRef,
  }));

  // 当提供 srcDoc 时，创建 Blob URL
  useEffect(() => {
    if (srcDoc) {
      const blob = new Blob([srcDoc], { type: "text/html" });
      const blobUrlStr = URL.createObjectURL(blob);
      setBlobUrl(blobUrlStr);
      return () => URL.revokeObjectURL(blobUrlStr);
    }
  }, [srcDoc]);

  // 处理加载完成
  const handleLoad = () => {
    setLoading(false);
    onLoad?.();
  };

  // 无内容时显示提示
  if (!url && !srcDoc) {
    return (
      <div className="wk-file-preview-html-iframe wk-file-preview-html-iframe--empty">
        {t("base.filePreview.empty")}
      </div>
    );
  }

  return (
    <>
      {loading && (
        <div className="wk-file-preview-html-iframe__loading">
          <Loading aria-label={t("base.filePreview.loading")} />
        </div>
      )}
      {blobUrl && (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          className={`wk-file-preview-html-iframe__iframe ${
            loading ? "wk-file-preview-html-iframe__iframe--hidden" : ""
          } ${iframeClassName || ""}`}
          style={iframeStyle}
          onLoad={handleLoad}
          sandbox="allow-scripts"
        />
      )}
      {url && !blobUrl && (
        <iframe
          ref={iframeRef}
          src={url}
          className={`wk-file-preview-html-iframe__iframe ${
            loading ? "wk-file-preview-html-iframe__iframe--hidden" : ""
          } ${iframeClassName || ""}`}
          style={iframeStyle}
          onLoad={handleLoad}
          sandbox="allow-scripts"
        />
      )}
    </>
  );
});

HtmlIframeRenderer.displayName = "HtmlIframeRenderer";

export default HtmlIframeRenderer;
export { HtmlIframeRenderer };
