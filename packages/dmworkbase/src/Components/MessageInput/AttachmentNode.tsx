import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";

// 文件类型图标
import defaultIcon from "../../assets/files/default.svg";
import docIcon from "../../assets/files/doc.svg";
import excelIcon from "../../assets/files/excel.svg";
import gifIcon from "../../assets/files/gif.svg";
import pdfIcon from "../../assets/files/pdf.svg";
import videoIcon from "../../assets/files/video.svg";
import zipIcon from "../../assets/files/zip.svg";
import videoPlayIcon from "../../assets/files/video2.svg";
import htmlIcon from "../../assets/files/html.svg";
import mdIcon from "../../assets/files/md.svg";
import txtIcon from "../../assets/files/txt.svg";

// 导出图标供外部使用
export {
  defaultIcon,
  docIcon,
  excelIcon,
  gifIcon,
  pdfIcon,
  videoIcon,
  zipIcon,
  videoPlayIcon,
  htmlIcon,
  mdIcon,
  txtIcon,
};

export interface AttachmentAttributes {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl?: string; // 图片预览 URL
  source?: "paste" | "upload"; // 附件来源：粘贴 or 上传按钮
}

function isImageType(type: string, name: string): boolean {
  if (type.startsWith("image/")) return true;
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.substring(dotIdx + 1).toLowerCase() : "";
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
}

function isVideoType(type: string, name: string): boolean {
  if (type.startsWith("video/")) return true;
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.substring(dotIdx + 1).toLowerCase() : "";
  return ["mp4", "avi", "mov", "mkv", "webm"].includes(ext);
}

/** 根据文件名和类型获取文件图标（导出供复用） */
export function getFileIcon(name: string, type: string): string {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.substring(dotIdx + 1).toLowerCase() : "";

  if (
    type.startsWith("video/") ||
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
  if (["html", "htm"].includes(ext)) {
    return htmlIcon;
  }
  if (ext === "md") {
    return mdIcon;
  }
  if (ext === "txt") {
    return txtIcon;
  }

  return defaultIcon;
}

/** 格式化文件大小（导出供复用） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentNodeViewProps {
  node: {
    attrs: AttachmentAttributes;
  };
  deleteNode: () => void;
  selected: boolean;
}

const AttachmentNodeView = ({
  node,
  deleteNode,
  selected,
}: AttachmentNodeViewProps) => {
  const { t } = useI18n();
  const { name, size, type, previewUrl } = node.attrs;
  const displayName = name || t("base.messageInput.attachment.unnamedFile");
  const isImage = isImageType(type, name) && previewUrl;

  // 图片类型：直接渲染图片预览
  if (isImage) {
    return (
      <NodeViewWrapper
        className={`wk-attachment-node wk-attachment-node--image ${
          selected ? "wk-attachment-node--selected" : ""
        }`}
        data-type="attachment"
      >
        <img
          src={previewUrl}
          alt={name}
          className="wk-attachment-node-image"
          draggable={false}
        />
      </NodeViewWrapper>
    );
  }

  // 非图片类型：渲染文件卡片
  const isVideo = isVideoType(type, name);
  const icon = getFileIcon(name, type);

  return (
    <NodeViewWrapper
      className={`wk-attachment-node ${
        selected ? "wk-attachment-node--selected" : ""
      }`}
      data-type="attachment"
    >
      <div className="wk-attachment-node-card">
        <div className="wk-attachment-node-icon">
          {isVideo && previewUrl ? (
            <div className="wk-attachment-node-video-cover-wrapper">
              <img
                src={previewUrl}
                alt="video cover"
                draggable={false}
                className="wk-attachment-node-video-cover"
              />
              <img
                src={videoPlayIcon}
                alt="play"
                className="wk-attachment-node-video-play-icon"
                draggable={false}
              />
            </div>
          ) : (
            <img src={icon} alt="file" draggable={false} />
          )}
        </div>
        <div className="wk-attachment-node-info">
          <div className="wk-attachment-node-name-row">
            <div className="wk-attachment-node-name" title={displayName}>
              {displayName}
            </div>
            <button
              className="wk-attachment-node-remove"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteNode();
              }}
              type="button"
              title={t("base.messageInput.attachment.remove")}
              contentEditable={false}
            >
              <X size={16} />
            </button>
          </div>
          <div className="wk-attachment-node-size">{formatFileSize(size)}</div>
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const AttachmentNode = Node.create({
  name: "attachment",

  group: "inline",

  inline: true,

  atom: true, // 不可编辑内部内容，作为整体选中/删除

  draggable: true,

  addAttributes() {
    return {
      id: {
        default: null,
      },
      name: {
        default: "",
      },
      size: {
        default: 0,
      },
      type: {
        default: "application/octet-stream",
      },
      previewUrl: {
        default: null,
      },
      source: {
        default: "upload",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="attachment"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "attachment" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentNodeView);
  },
});

export default AttachmentNode;
