// File-type icon resolver for the global-search result rows (drive / docs /
// files tabs).
//
// Uses the dmworkbase icon pack under ../../assets/files (48x48 viewBox
// "0 0 48 48", 8px padding + white rounded backplate — the "card" style also
// consumed by chat composer / file preview / channel search) so all consumer
// surfaces share a single icon asset.
//
// Note: the pack has no `folder.svg`, no `doc-online.svg` and no `code.svg`;
// those three cases fall back to the generic `default.svg`.

import defaultIcon from "../../assets/files/default.svg";
import docIcon from "../../assets/files/doc.svg";
import excelIcon from "../../assets/files/excel.svg";
import pptIcon from "../../assets/files/ppt.svg";
import csvIcon from "../../assets/files/csv.svg";
import pdfIcon from "../../assets/files/pdf.svg";
import zipIcon from "../../assets/files/zip.svg";
import videoIcon from "../../assets/files/video.svg";
import audioIcon from "../../assets/files/audio.svg";
import gifIcon from "../../assets/files/gif.svg";
import imageIcon from "../../assets/files/image.svg";
import htmlIcon from "../../assets/files/html.svg";
import mdIcon from "../../assets/files/md.svg";
import txtIcon from "../../assets/files/txt.svg";
import boardIcon from "../../assets/files/board.svg";

import type {
  DriveFileType,
  DriveDocType,
  DocSearchDocType,
} from "../../Service/SearchTypes";

/** Extension → icon URL. Lower-case keys, no leading dot. Mirrors
 *  octo-drive-module src/ui/FileList/fileIcon.ts EXT_ICONS. Code / folder /
 *  doc-online extensions collapse to the generic default until the legacy pack
 *  gains those glyphs. */
const EXT_ICONS: Record<string, string> = {
  pdf: pdfIcon,
  doc: docIcon,
  docx: docIcon,
  xls: excelIcon,
  xlsx: excelIcon,
  ppt: pptIcon,
  pptx: pptIcon,
  csv: csvIcon,
  zip: zipIcon,
  rar: zipIcon,
  "7z": zipIcon,
  tar: zipIcon,
  gz: zipIcon,
  mp4: videoIcon,
  mov: videoIcon,
  avi: videoIcon,
  mkv: videoIcon,
  webm: videoIcon,
  mp3: audioIcon,
  wav: audioIcon,
  aac: audioIcon,
  flac: audioIcon,
  ogg: audioIcon,
  gif: gifIcon,
  png: imageIcon,
  jpg: imageIcon,
  jpeg: imageIcon,
  webp: imageIcon,
  bmp: imageIcon,
  svg: imageIcon,
  html: htmlIcon,
  htm: htmlIcon,
  md: mdIcon,
  txt: txtIcon,
};

/** Online-doc kind → icon URL. The legacy pack has no `doc-online` variant, so
 *  the `doc` kind reuses the generic doc.svg (same glyph as .docx). `sheet`
 *  (在线表格) is semantically the same as excel (.xlsx) and shares excel.svg
 *  rather than shipping a duplicate green-table glyph. */
const DOC_ICONS: Record<DocSearchDocType, string> = {
  doc: docIcon,
  sheet: excelIcon,
  board: boardIcon,
  html: htmlIcon,
};

/** Online-doc sub-type (drive-search `doc_type`) → icon URL. `sheet` shares
 *  excel.svg (在线表格 == .xlsx) and `html_ppt` (HTML 版 PPT) shares ppt.svg,
 *  rather than shipping duplicate glyphs. Kept separate from DOC_ICONS (docs
 *  tab) because drive-search adds the `html_ppt` kind. */
const DRIVE_DOC_ICONS: Record<DriveDocType, string> = {
  doc: docIcon,
  sheet: excelIcon,
  board: boardIcon,
  html: htmlIcon,
  html_ppt: pptIcon,
};

/** Pull the extension off a file name, case- and dot-insensitive. Returns `''`
 *  for names with no dot or a trailing dot only. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Icon for a file resolved purely by its name's extension (blob drive hits and
 *  chat-file hits share this). Unknown extensions fall back to default.svg. */
export function fileIconSrc(name: string): string {
  return EXT_ICONS[extOf(name)] ?? defaultIcon;
}

/** Icon for a drive online-doc hit (type='doc') by its backend `doc_type`.
 *  Missing or unknown doc_type falls back to the generic doc.svg (same glyph as
 *  .docx), so a doc hit never breaks when the field is absent. */
export function driveDocIconSrc(docType?: string): string {
  return (docType && DRIVE_DOC_ICONS[docType as DriveDocType]) || docIcon;
}

/** Icon for a drive search hit: online-docs dispatch by `doc_type` (falling back
 *  to the generic doc glyph), blobs dispatch by extension, folders fall back to
 *  the generic default (legacy pack lacks a dedicated folder glyph). */
export function driveIconSrc(
  type: DriveFileType,
  name: string,
  docType?: string
): string {
  if (type === "folder") return defaultIcon;
  if (type === "doc") return driveDocIconSrc(docType);
  return fileIconSrc(name);
}

/** Icon for a cloud-doc (docs tab) by its kind. */
export function docIconSrc(kind: DocSearchDocType): string {
  return DOC_ICONS[kind];
}
