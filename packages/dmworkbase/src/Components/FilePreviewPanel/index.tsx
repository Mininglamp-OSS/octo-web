import React from "react";
import { X, Download, ExternalLink } from "lucide-react";
import { fileRendererRegistry } from "./registry";
import { FilePreviewInfo, FilePreviewPanelProps, getExtension } from "./types";
import { useI18n } from "../../i18n";
import "./index.css";

/**
 * 文件预览面板组件
 * 基于策略模式，根据文件类型选择对应的渲染器
 */
const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  file,
  onClose,
}) => {
  const { t } = useI18n();

  if (!file) return null;

  const ext = getExtension(file.extension, file.name);
  const { renderer: Renderer } = fileRendererRegistry.getRenderer(ext);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name || "file";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenExternal = () => {
    window.open(file.url, "_blank");
  };

  const handleError = (error: string) => {
    console.error("FilePreviewPanel error:", error);
  };

  return (
    <div className="wk-file-preview-panel">
      {/* Header */}
      <div className="wk-file-preview-header">
        <div className="wk-file-preview-title" title={file.name}>
          {file.name}
        </div>
        <div className="wk-file-preview-actions">
          <button
            className="wk-file-preview-action"
            title={t("base.filePreview.openInNewWindow")}
            onClick={handleOpenExternal}
          >
            <ExternalLink size={18} />
          </button>
          <button
            className="wk-file-preview-action"
            title={t("base.filePreview.download")}
            onClick={handleDownload}
          >
            <Download size={18} />
          </button>
          <button
            className="wk-file-preview-action wk-file-preview-close"
            title={t("base.filePreview.close")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content - 策略模式：根据文件类型渲染不同组件 */}
      <div className="wk-file-preview-content">
        <Renderer file={file} onError={handleError} />
      </div>
    </div>
  );
};

/**
 * 判断文件是否支持在面板中预览
 */
export function canPreviewInPanel(extension: string, name?: string): boolean {
  return fileRendererRegistry.canPreview(extension, name);
}

// 导出类型
export type { FilePreviewInfo, FilePreviewPanelProps };

// 导出注册表，允许外部扩展
export { fileRendererRegistry };

// 导出所有渲染器
export * from "./renderers";

// 导出类型定义
export * from "./types";

// 导出 Header 组件
export { FilePreviewHeader } from "./FilePreviewHeader";
export type {
  FilePreviewHeaderProps,
  ConversationFile,
} from "./FilePreviewHeader";

export default FilePreviewPanel;
export { FilePreviewPanel };
