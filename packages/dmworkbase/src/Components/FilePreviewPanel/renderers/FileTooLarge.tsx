import React from "react";
import { Download, FileWarning } from "lucide-react";
import { formatFileSize } from "../config";
import { downloadFile } from "../../../Utils/download";
import { useI18n } from "../../../i18n";
import "./FileTooLarge.css";

export interface FileTooLargeProps {
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 文件下载 URL */
  fileUrl: string;
}

/**
 * 文件过大提示组件
 *
 * 当文件大小超过 20MB 阈值时显示此组件
 * 提示用户下载到本地查看
 */
const FileTooLarge: React.FC<FileTooLargeProps> = ({
  fileName,
  fileSize,
  fileUrl,
}) => {
  const { t } = useI18n();

  const handleDownload = () => {
    void downloadFile(fileUrl, fileName || "file");
  };

  return (
    <div className="wk-file-too-large">
      <div className="wk-file-too-large__icon">
        <FileWarning size={48} strokeWidth={1.5} />
      </div>
      <div className="wk-file-too-large__content">
        <h3 className="wk-file-too-large__title">
          {t("base.filePreview.largeFileTitle")}
        </h3>
        <p className="wk-file-too-large__message">
          {t("base.filePreview.largeFileMessage", {
            values: { size: formatFileSize(fileSize) },
          })}
        </p>
      </div>
      <button
        type="button"
        className="wk-file-too-large__download-btn"
        onClick={handleDownload}
      >
        <Download size={16} />
        <span>{t("base.filePreview.downloadFile")}</span>
      </button>
    </div>
  );
};

export default FileTooLarge;
export { FileTooLarge };
