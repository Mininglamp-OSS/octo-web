export type UpdaterPlatform = "macos" | "windows" | "linux";

export interface DesktopUpdateInfo {
  version: string;
  url: string;
  notes?: string;
  pub_date?: string;
  signature?: string;
  forceUpdate?: boolean;
}

export interface ParseUpdateInfoOptions {
  allowInsecureHttp?: boolean;
  platform?: NodeJS.Platform;
}

export function parseUpdaterCheckResult(raw: unknown, options: ParseUpdateInfoOptions = {}): DesktopUpdateInfo | null {
  if (isNullEnvelope(raw)) return null;
  const value = unwrapUpdaterPayload(raw);
  if (isNoUpdatePayload(value)) return null;
  return parseUpdateInfo(value, options);
}

export function getUpdaterPlatform(platform: NodeJS.Platform = process.platform): UpdaterPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

export function buildUpdaterCheckUrl(options: {
  updaterApiUrl: string;
  version: string;
  platform?: NodeJS.Platform;
}): string {
  const base = normalizeUpdaterApiBaseUrl(options.updaterApiUrl);
  return new URL(
    `${getUpdaterPlatform(options.platform)}/${encodeURIComponent(options.version)}`,
    base,
  ).toString();
}

function normalizeUpdaterApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Updater API URL must be http(s)");
  }
  if (url.search || url.hash) {
    throw new Error("Updater API URL must not include query or hash");
  }
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function parseUpdateInfo(raw: unknown, options: ParseUpdateInfoOptions = {}): DesktopUpdateInfo {
  const value = unwrapUpdaterPayload(raw);
  const version = typeof value.version === "string" ? value.version.trim() : "";
  const urlValue = value.url ?? value.download_url ?? value.downloadUrl;
  const url = typeof urlValue === "string" ? urlValue.trim() : "";
  if (!version) throw new Error("Updater response is missing version");
  if (!url) throw new Error("Updater response is missing url");
  const parsedUrl = new URL(url);
  if (!isAllowedUpdaterDownloadUrl(parsedUrl, options.allowInsecureHttp)) {
    throw new Error("Updater response url must be https, or http on localhost when explicitly allowed");
  }
  if (options.platform && !isAllowedUpdaterPackageUrl(parsedUrl, getUpdaterPlatform(options.platform))) {
    throw new Error("Updater response url extension does not match current platform");
  }
  return {
    version,
    url: parsedUrl.toString(),
    notes: typeof value.notes === "string" ? value.notes : "",
    pub_date: typeof value.pub_date === "string" ? value.pub_date : "",
    signature: typeof value.signature === "string" ? value.signature : "",
    forceUpdate: parseForceUpdate(value),
  };
}

function unwrapUpdaterPayload(raw: unknown): Record<string, unknown> {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const data = value.data;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return value;
}

function isNullEnvelope(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "data" in raw && (raw as Record<string, unknown>).data === null);
}

function isNoUpdatePayload(value: Record<string, unknown>): boolean {
  const raw = value.update ?? value.hasUpdate ?? value.has_update ?? value.shouldUpdate ?? value.should_update ?? value.needUpdate ?? value.need_update;
  return parseBooleanFlag(raw) === false;
}

export function isAllowedUpdaterPackageUrl(url: URL, platform: UpdaterPlatform): boolean {
  const pathname = decodeURIComponent(url.pathname).toLowerCase();
  if (platform === "macos") return pathname.endsWith(".zip");
  if (platform === "windows") return pathname.endsWith(".exe");
  return pathname.endsWith(".appimage") || pathname.endsWith(".deb") || pathname.endsWith(".rpm");
}

function isAllowedUpdaterDownloadUrl(url: URL, allowInsecureHttp = false): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:" || !allowInsecureHttp) return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function parseForceUpdate(value: Record<string, unknown>): boolean {
  const raw = value.forceUpdate ?? value.force_update ?? value.force ?? value.required ?? value.mandatory;
  return parseBooleanFlag(raw) === true;
}

function parseBooleanFlag(raw: unknown): boolean | undefined {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

export function getDownloadedUpdateFileName(url: string, version: string, platform: UpdaterPlatform): string {
  let name = "";
  try {
    const pathname = new URL(url).pathname;
    name = pathname.endsWith("/") ? "" : decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    name = "";
  }
  const fallbackExt = platform === "windows" ? "exe" : platform === "macos" ? "zip" : "AppImage";
  const fallback = `OCTO-${version}.${fallbackExt}`;
  const candidate = name || fallback;
  return candidate.replace(/[\\/:*?"<>|]/g, "_");
}

export function isZipUpdatePackage(filePathOrUrl: string): boolean {
  const pathName = (() => {
    try {
      return new URL(filePathOrUrl).pathname;
    } catch {
      return filePathOrUrl;
    }
  })();
  return pathName.toLowerCase().endsWith(".zip");
}

export function getMacAppBundlePath(execPath: string): string {
  const parts = execPath.split("/");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.toLowerCase().endsWith(".app")) {
      return parts.slice(0, index + 1).join("/") || "/";
    }
  }
  throw new Error("Current executable is not inside a macOS app bundle");
}

export function getMacAppBundleName(appPath: string): string {
  const parts = appPath.split("/").filter(Boolean);
  const name = parts[parts.length - 1] || "";
  if (!name.toLowerCase().endsWith(".app")) {
    throw new Error("macOS app bundle path must end with .app");
  }
  return name;
}
