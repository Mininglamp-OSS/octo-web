import { getFileIconByExtension } from "../../Utils/fileIcon";

function normalizeFileExtension(extension?: string) {
  return extension?.trim().replace(/^\./, "").toLowerCase() || "";
}

function getFileNameExtension(fileName: string) {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === fileName.length - 1) {
    return "";
  }
  return fileName.slice(dotIdx + 1).toLowerCase();
}

export function extensionForIconLookup(fileName: string, extension?: string) {
  const ext = normalizeFileExtension(extension);
  if (!ext) {
    return getFileNameExtension(fileName);
  }
  return ext;
}

export function resolveChannelSearchFileIconSrc(
  fileName: string,
  extension?: string
) {
  return getFileIconByExtension(extensionForIconLookup(fileName, extension));
}

export const channelSearchFileIconTestUtils = {
  extensionForIconLookup,
  resolveChannelSearchFileIconSrc,
};
