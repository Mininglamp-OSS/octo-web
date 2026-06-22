// 文件类型图标
import defaultIcon from "../assets/files/default.svg";
import docIcon from "../assets/files/doc.svg";
import excelIcon from "../assets/files/excel.svg";
import gifIcon from "../assets/files/gif.svg";
import pdfIcon from "../assets/files/pdf.svg";
import videoIcon from "../assets/files/video.svg";
import zipIcon from "../assets/files/zip.svg";
import videoPlayIcon from "../assets/files/video2.svg";
import htmlIcon from "../assets/files/html.svg";
import mdIcon from "../assets/files/md.svg";
import txtIcon from "../assets/files/txt.svg";

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

function getFileNameExtension(name: string) {
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.substring(dotIdx + 1).toLowerCase() : "";
}

function normalizeFileExtension(extension?: string) {
  return extension?.trim().replace(/^\./, "").toLowerCase() || "";
}

export function getFileIconByExtension(extension?: string, type = "") {
  const ext = normalizeFileExtension(extension);

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

/** 根据文件名和类型获取文件图标（导出供复用） */
export function getFileIcon(name: string, type: string): string {
  return getFileIconByExtension(getFileNameExtension(name), type);
}

/** 格式化文件大小（导出供复用） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
