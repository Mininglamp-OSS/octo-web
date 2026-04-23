import React, { useRef, useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import ConversationContext from "../Conversation/context";
import "./index.css";

// 文件类型图标
import defaultIcon from "../../assets/files/default.svg";
import docIcon from "../../assets/files/doc.svg";
import excelIcon from "../../assets/files/excel.svg";
import gifIcon from "../../assets/files/gif.svg";
import pdfIcon from "../../assets/files/pdf.svg";
import videoIcon from "../../assets/files/video.svg";
import zipIcon from "../../assets/files/zip.svg";

interface AttachmentPreviewProps {
  conversationContext: ConversationContext;
  files: File[];
}

function getFileIcon(file: File): string {
  const dotIdx = file.name.lastIndexOf(".");
  const ext = dotIdx > 0 ? file.name.substring(dotIdx + 1).toLowerCase() : "";

  // 根据 MIME 类型或扩展名返回对应图标
  if (
    file.type.startsWith("video/") ||
    ["mp4", "avi", "mov", "mkv", "webm"].includes(ext)
  ) {
    return videoIcon;
  }
  if (ext === "gif") {
    return gifIcon;
  }
  if (ext === "pdf") {
    return pdfIcon;
  }
  if (["doc", "docx"].includes(ext)) {
    return docIcon;
  }
  if (["xls", "xlsx"].includes(ext)) {
    return excelIcon;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return zipIcon;
  }

  return defaultIcon;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  conversationContext,
  files,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // 检查是否需要显示滚动按钮
  const checkScrollButtons = () => {
    const el = listRef.current;
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 1);
  };

  useEffect(() => {
    checkScrollButtons();
    // 监听窗口大小变化
    window.addEventListener("resize", checkScrollButtons);
    return () => window.removeEventListener("resize", checkScrollButtons);
  }, [files]);

  const scrollLeft = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: -240, behavior: "smooth" });
  };

  const scrollRight = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: 240, behavior: "smooth" });
  };

  if (!files || files.length === 0) return null;

  return (
    <div className="wk-attachment-preview">
      {showLeftArrow && (
        <button
          className="wk-attachment-scroll-btn wk-attachment-scroll-btn--left"
          onClick={scrollLeft}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        className="wk-attachment-preview-list"
        ref={listRef}
        onScroll={checkScrollButtons}
      >
        {files.map((file, index) => (
          <div
            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
            className="wk-attachment-preview-item"
          >
            <div className="wk-attachment-preview-icon">
              <img src={getFileIcon(file)} alt="file" />
            </div>
            <div className="wk-attachment-preview-info">
              <div className="wk-attachment-preview-name-row">
                <div className="wk-attachment-preview-name" title={file.name}>
                  {file.name}
                </div>
                <button
                  className="wk-attachment-preview-remove"
                  onClick={() =>
                    conversationContext.removePendingAttachment(index)
                  }
                  title="移除"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="wk-attachment-preview-size">
                {formatFileSize(file.size)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showRightArrow && (
        <button
          className="wk-attachment-scroll-btn wk-attachment-scroll-btn--right"
          onClick={scrollRight}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
};

export default AttachmentPreview;
export { AttachmentPreview };
