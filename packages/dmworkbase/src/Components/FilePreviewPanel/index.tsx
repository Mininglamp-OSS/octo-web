import { useHtmlAttachmentActions } from "../../bridge/html-attachment/useHtmlAttachmentActions";
import React from "react";
import { X, Download, ExternalLink } from "lucide-react";
import { fileRendererRegistry } from "./registry";
import { downloadFile } from "../../Utils/download";
import { FilePreviewInfo, FilePreviewPanelProps, getExtension } from "./types";
import { useI18n } from "../../i18n";
import { HostFilePreviewSlot } from "../../features/filePreview/HostFilePreviewSlot";
import "./index.css";

/**
 * 文件预览面板组件
 * 基于策略模式，根据文件类型选择对应的渲染器
 */
const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  file,
  onClose,
  showOpenExternal = true,
}) => {
  const { t } = useI18n();
  const htmlActions = useHtmlAttachmentActions(file?.hostPreview ? null : file);

  if (!file) return null;
  if (file.hostPreview) {
    return (
      <div className="wk-file-preview-panel" data-desktop-overlay="">
        <HostFilePreviewSlot {...file.hostPreview} onClose={onClose} />
      </div>
    );
  }

  const ext = getExtension(file.extension, file.name);
  const { renderer: Renderer } = fileRendererRegistry.getRenderer(ext);

  const handleDownload = () => {
    if (htmlActions.enabled) {
      void htmlActions.download();
      return;
    }
    void downloadFile(file.url, file.name || "file");
  };

  const handleOpenExternal = () => {
    if (htmlActions.enabled) {
      htmlActions.open();
      return;
    }
    window.open(file.url, "_blank");
  };

  const handleError = (error: string) => {
    console.error("FilePreviewPanel error:", error);
  };

  return (
    <div className="wk-file-preview-panel" data-desktop-overlay="">
      {/* Header */}
      <div className="wk-file-preview-header" data-desktop-chrome="header">
        <div className="wk-file-preview-title" title={file.name}>
          {file.name}
        </div>
        <div className="wk-file-preview-actions">
          {showOpenExternal && (
            <button
              className="wk-file-preview-action"
              title={t("base.filePreview.openInNewWindow")}
              onClick={handleOpenExternal}
            >
              <ExternalLink size={18} />
            </button>
          )}
          <button
            className="wk-file-preview-action"
            title={t(htmlActions.pending
              ? "base.htmlAttachment.preparing"
              : "base.filePreview.download")}
            disabled={htmlActions.pending}
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
