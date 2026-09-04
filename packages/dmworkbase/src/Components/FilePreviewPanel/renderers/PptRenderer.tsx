import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from "react";
import { BaseRendererProps } from "../types";
import PptPageRenderer, { PptPageContent } from "./PptPageRenderer";
import { useI18n } from "../../../i18n";
import { Empty, Loading } from "@octo/ui";
import "./PptRenderer.css";

/** PPT 页面数据 */
export interface PptPageData extends PptPageContent {
  index: number;
}

/** PPT 数据结构 */
export interface PptData {
  total: number;
  data: PptPageData[];
}

/** PptRenderer 引用接口 */
export interface PptRendererRef {
  /** 跳转到指定页面 */
  jumpToPage: (page: number) => void;
}

/** PptRenderer 属性 */
export interface PptRendererProps extends BaseRendererProps {
  /** 是否仅预览模式 */
  previewOnly?: boolean;
}

/**
 * 解析 PPT 数据
 * 支持两种格式：
 * 1. JSON 格式: { total: number, data: PptPageData[] }
 * 2. URL 指向的 JSON 文件
 */
const parsePptData = async (
  url: string,
  t: (key: string) => string
): Promise<{ data: PptData | null; error: string | null }> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { data: null, error: t("base.filePreview.ppt.loadDataFailed") };
    }

    const json = await response.json();

    // 验证数据结构
    if (
      typeof json.total !== "number" ||
      !Array.isArray(json.data)
    ) {
      return { data: null, error: t("base.filePreview.ppt.invalidData") };
    }

    return { data: json as PptData, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : t("base.filePreview.ppt.parseDataFailed"),
    };
  }
};

/**
 * PPT 渲染器
 * 渲染多个 PPT 页面，支持页面跳转
 * 设计风格: Refined Presentation Mode
 */
const PptRenderer = forwardRef<PptRendererRef, PptRendererProps>(
  ({ file, onError, previewOnly = false }, ref) => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pptData, setPptData] = useState<PptData | null>(null);

    // 页面引用数组
    const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      jumpToPage: (page: number) => {
        if (pptData && page >= 1 && page <= pptData.total) {
          const targetRef = pageRefs.current[page - 1];
          if (targetRef) {
            targetRef.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      },
    }));

    // 加载 PPT 数据
    useEffect(() => {
      const loadPptData = async () => {
        setLoading(true);
        setError(null);

        const { data, error: parseError } = await parsePptData(file.url, t);

        if (parseError) {
          setError(parseError);
          onError?.(parseError);
        } else {
          setPptData(data);
        }

        setLoading(false);
      };

      loadPptData();
    }, [file.url, onError, t]);

    // 加载中状态
    if (loading) {
      return (
        <div className="wk-file-preview-ppt-renderer wk-file-preview-ppt-renderer--loading">
          <Loading text={t("base.filePreview.ppt.loadingPresentation")} layout="vertical" />
        </div>
      );
    }

    // 错误状态
    if (error) {
      return (
        <div className="wk-file-preview-ppt-renderer wk-file-preview-ppt-renderer--error">
          <span className="wk-file-preview-ppt-renderer__error-text">{error}</span>
        </div>
      );
    }

    // 无数据
    if (!pptData || pptData.data.length === 0) {
      return (
        <div className="wk-file-preview-ppt-renderer wk-file-preview-ppt-renderer--empty">
          <Empty
            illustration={false}
            description={t("base.filePreview.ppt.noContent")}
          />
        </div>
      );
    }

    return (
      <div className="wk-file-preview-ppt-renderer">
        <div className="wk-file-preview-ppt-renderer__content">
          {pptData.data.map((page, idx) => {
            const key = ("content" in page) ? page.content : (page as { url: string }).url;
            return (
              <div
                key={key || idx}
                ref={(el) => {
                  pageRefs.current[page.index] = el;
                }}
              >
                <PptPageRenderer
                  index={page.index || idx + 1}
                  total={pptData.total}
                  previewOnly={previewOnly}
                  pageId={`ppt-${file.name}-${page.index || idx}`}
                  {...(("content" in page)
                    ? { content: page.content }
                    : { url: (page as { url: string }).url })}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

PptRenderer.displayName = "PptRenderer";

export default PptRenderer;
export { PptRenderer };
