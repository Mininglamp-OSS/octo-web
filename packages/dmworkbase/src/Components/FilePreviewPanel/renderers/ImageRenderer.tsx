import React, { useState, useRef, useEffect, useCallback } from "react";
import { BaseRendererProps } from "../types";
import { isFileTooLarge } from "../config";
import FileTooLarge from "./FileTooLarge";
import { useI18n } from "../../../i18n";
import { Loading } from "@octo/ui";
import "./ImageRenderer.css";

export interface ImageRendererProps extends BaseRendererProps {
  /** 渲染模式：'cover' - 短边占满，'contain' - 长边占满，'auto' - 根据图片宽高比自动适应 */
  mode?: "cover" | "contain" | "auto";
}

/**
 * 图片渲染器
 * 支持 png, jpg, jpeg, gif, bmp, webp, svg 格式
 *
 * 特性：
 * 1. 智能适应模式（auto/cover/contain）
 * 2. 使用 ResizeObserver 监测容器尺寸变化
 * 3. 加载中/加载失败状态显示
 * 4. 圆角和过渡动画
 */
const ImageRenderer: React.FC<ImageRendererProps> = ({
  file,
  onError,
  mode = "auto",
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 监测容器尺寸变化
  useEffect(() => {
    const updateContainerSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth && clientHeight) {
          setContainerSize({ width: clientWidth, height: clientHeight });
        }
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleLoad = useCallback(() => {
    if (imgRef.current) {
      const { naturalWidth, naturalHeight } = imgRef.current;
      setImageSize({ width: naturalWidth, height: naturalHeight });
    }
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setHasError(true);
    onError?.(t("base.filePreview.image.loadFailed"));
  }, [onError, t]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setHasError(false);
  }, []);

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

  // 根据图片尺寸、容器尺寸和模式计算图片样式类
  const getImageFitClass = (): string => {
    if (mode === "cover") {
      return "wk-file-preview-image-renderer__img--cover";
    }

    if (mode === "contain") {
      return "wk-file-preview-image-renderer__img--contain";
    }

    // auto 模式：计算哪个维度先触碰到容器边界
    if (imageSize.width === 0 || containerSize.width === 0) {
      return "wk-file-preview-image-renderer__img--contain";
    }

    const scaleByWidth = containerSize.width / imageSize.width;
    const scaleByHeight = containerSize.height / imageSize.height;

    if (scaleByWidth <= scaleByHeight) {
      return "wk-file-preview-image-renderer__img--fit-width";
    } else {
      return "wk-file-preview-image-renderer__img--fit-height";
    }
  };

  if (hasError) {
    return (
      <div className="wk-file-preview-image-renderer wk-file-preview-image-renderer--error-state">
        <div className="wk-file-preview-image-renderer__error">
          <div className="wk-file-preview-image-renderer__error-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          </div>
          <span className="wk-file-preview-image-renderer__error-text">
            {t("base.filePreview.image.loadFailed")}
          </span>
          <button
            className="wk-file-preview-image-renderer__retry"
            onClick={handleRetry}
          >
            {t("base.filePreview.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="wk-file-preview-image-renderer">
      <div className="wk-file-preview-image-renderer__content">
        {loading && (
          <div className="wk-file-preview-image-renderer__loading">
            <Loading text={t("base.filePreview.loading")} layout="vertical" />
          </div>
        )}

        <img
          ref={imgRef}
          key={hasError ? "retry" : "normal"}
          src={file.url}
          alt={file.name}
          className={`wk-file-preview-image-renderer__img ${getImageFitClass()} ${
            loading
              ? "wk-file-preview-image-renderer__img--loading"
              : "wk-file-preview-image-renderer__img--loaded"
          }`}
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  );
};

export default ImageRenderer;
export { ImageRenderer };
