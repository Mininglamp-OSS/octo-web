import { basename, extname } from "path";

export type DownloadSettings = { directory: string; askBeforeSaving: boolean };
export const DOWNLOAD_SETTINGS_VERSION = 1;

export function sanitizeDownloadFilename(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  let sanitized = candidate
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "");
  if (!sanitized || sanitized === "." || sanitized === "..") return fallback;
  const extension = extname(sanitized);
  let stem = basename(sanitized, extension);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
  const maxBytes = 240;
  const trimToBytes = (value: string, limit: number) => {
    while (Buffer.byteLength(value, "utf8") > limit) value = value.slice(0, -1);
    return value;
  };
  const trimmedExtension = trimToBytes(extension, maxBytes);
  stem = trimToBytes(stem, Math.max(1, maxBytes - Buffer.byteLength(trimmedExtension, "utf8")));
  sanitized = `${stem || "download"}${trimmedExtension}`;
  return sanitized || fallback;
}

export function normalizeDownloadSettings(raw: unknown, defaultDirectory: string, legacyDefault: string): DownloadSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const directory = typeof value.directory === "string" && value.directory ? value.directory : defaultDirectory;
  return {
    directory: value.version === DOWNLOAD_SETTINGS_VERSION
      ? directory
      : directory === legacyDefault ? defaultDirectory : directory,
    askBeforeSaving: value.askBeforeSaving === true,
  };
}
