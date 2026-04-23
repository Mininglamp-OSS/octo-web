import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";
import { X } from "lucide-react";

// 文件类型图标
import defaultIcon from "../../assets/files/default.svg";
import docIcon from "../../assets/files/doc.svg";
import excelIcon from "../../assets/files/excel.svg";
import gifIcon from "../../assets/files/gif.svg";
import pdfIcon from "../../assets/files/pdf.svg";
import videoIcon from "../../assets/files/video.svg";
import zipIcon from "../../assets/files/zip.svg";

export interface AttachmentAttributes {
  id: string;
  name: string;
  size: number;
  type: string;
}

function getFileIcon(name: string, type: string): string {
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

  return defaultIcon;
}

function formatFileSize(bytes: number): string {
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
  const { name, size, type } = node.attrs;
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
          <img src={icon} alt="file" draggable={false} />
        </div>
        <div className="wk-attachment-node-info">
          <div className="wk-attachment-node-name-row">
            <div className="wk-attachment-node-name" title={name}>
              {name}
            </div>
            <button
              className="wk-attachment-node-remove"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteNode();
              }}
              type="button"
              title="移除"
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
        default: "未命名文件",
      },
      size: {
        default: 0,
      },
      type: {
        default: "application/octet-stream",
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
