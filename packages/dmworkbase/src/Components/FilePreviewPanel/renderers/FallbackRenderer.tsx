import React, { useState } from "react";
import {
  Download,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  File,
  Loader2,
  Info,
} from "lucide-react";
import { BaseRendererProps } from "../types";
import { formatFileSize } from "../config";
import { downloadFile } from "../../../Utils/download";
import { useI18n } from "../../../i18n";
import "./FallbackRenderer.css";

export interface FallbackRendererProps extends BaseRendererProps {}

// 文件类型图标映射
const FILE_TYPE_ICONS: Record<
  string,
  React.FC<{ size?: number; className?: string }>
> = {
  // 文档类
  doc: FileText,
  docx: FileText,
  ppt: FileText,
  pptx: FileText,
  xls: FileText,
  xlsx: FileText,
  // 图片类
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  bmp: FileImage,
  webp: FileImage,
  svg: FileImage,
  // 视频类
  mp4: FileVideo,
  avi: FileVideo,
  mov: FileVideo,
  mkv: FileVideo,
  webm: FileVideo,
  // 音频类
  mp3: FileAudio,
  wav: FileAudio,
  aac: FileAudio,
  flac: FileAudio,
  ogg: FileAudio,
};

// 获取文件图标
function getFileIcon(
  extension: string
): React.FC<{ size?: number; className?: string }> {
  const ext = extension.toLowerCase();
  return FILE_TYPE_ICONS[ext] || File;
}

/**
 * 兜底渲染器
 * 用于不支持预览的文件类型，显示文件信息和下载按钮
 */
const FallbackRenderer: React.FC<FallbackRendererProps> = ({ file }) => {
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleDownload = async () => {
    if (loading) return;

    setLoading(true);
    try {
      await downloadFile(file.url, file.name || "file");
    } finally {
      // 模拟下载延迟，给用户反馈
      setTimeout(() => setLoading(false), 500);
    }
  };

  const FileIcon = getFileIcon(file.extension);
  const fileSize = formatFileSize(file.size);

  return (
    <div className="wk-file-preview-fallback-renderer">
      <div className="wk-file-preview-fallback-renderer__card">
        {/* 文件图标 */}
        <div className="wk-file-preview-fallback-renderer__icon">
          <FileIcon size={32} />
        </div>

        {/* 文件信息 */}
        <div className="wk-file-preview-fallback-renderer__info">
          <div
            className="wk-file-preview-fallback-renderer__name"
            title={file.name}
          >
            {file.name || `file.${file.extension}`}
          </div>
          {fileSize && (
            <div className="wk-file-preview-fallback-renderer__size">
              {fileSize}
            </div>
          )}
        </div>

        {/* 下载按钮 */}
        <button
          type="button"
          className="wk-file-preview-fallback-renderer__download-btn"
          onClick={handleDownload}
          disabled={loading}
        >
          {loading ? (
            <Loader2
              size={16}
              className="wk-file-preview-fallback-renderer__spinner"
            />
          ) : (
            <Download size={16} />
          )}
          <span>{t("base.filePreview.download")}</span>
        </button>
      </div>

      {/* 提示信息 */}
      <div className="wk-file-preview-fallback-renderer__hint">
        <Info size={16} />
        <span>{t("base.filePreview.unsupportedType")}</span>
      </div>
    </div>
  );
};

export default FallbackRenderer;
export { FallbackRenderer };
