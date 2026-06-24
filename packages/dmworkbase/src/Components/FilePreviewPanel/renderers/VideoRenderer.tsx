import React, { useCallback, useState } from "react";
import { BaseRendererProps } from "../types";
import { useI18n } from "../../../i18n";
import "./VideoRenderer.css";

export interface VideoRendererProps extends BaseRendererProps {}

const VideoRenderer: React.FC<VideoRendererProps> = ({ file, onError }) => {
  const { t } = useI18n();
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.(t("base.filePreview.video.loadFailed"));
  }, [onError, t]);

  const handleRetry = useCallback(() => {
    setHasError(false);
  }, []);

  if (hasError) {
    return (
      <div className="wk-file-preview-video-renderer wk-file-preview-video-renderer--error-state">
        <div className="wk-file-preview-video-renderer__error">
          <span className="wk-file-preview-video-renderer__error-text">
            {t("base.filePreview.video.loadFailed")}
          </span>
          <button
            className="wk-file-preview-video-renderer__retry"
            onClick={handleRetry}
          >
            {t("base.filePreview.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wk-file-preview-video-renderer">
      <video
        key={hasError ? "retry" : file.url}
        className="wk-file-preview-video-renderer__video"
        controls
        onError={handleError}
        playsInline
        poster={file.posterUrl}
        src={file.url}
      />
    </div>
  );
};

export default VideoRenderer;
export { VideoRenderer };
