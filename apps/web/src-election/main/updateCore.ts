export type UpdaterPlatform = "macos" | "windows" | "linux";

export interface DesktopUpdateInfo {
  version: string;
  url: string;
  notes?: string;
  pub_date?: string;
  sha256?: string;
  sha512?: string;
  forceUpdate?: boolean;
}

export interface ParseUpdateInfoOptions {
  allowInsecureHttp?: boolean;
  expectedDownloadOrigin?: string;
  platform?: NodeJS.Platform;
}

export function parseUpdaterCheckResult(raw: unknown, options: ParseUpdateInfoOptions = {}): DesktopUpdateInfo | null {
  if (isNullEnvelope(raw)) return null;
  const value = unwrapUpdaterPayload(raw);
  if (isNoUpdatePayload(value)) return null;
  if (!hasUpdateInfoFields(value)) return null;
  return parseUpdateInfoPayload(value, options);
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
  if (url.protocol !== "https:" && !isLocalhostHttpUrl(url)) {
    throw new Error("Updater API URL must be https, or http on localhost");
  }
  if (url.search || url.hash) {
    throw new Error("Updater API URL must not include query or hash");
  }
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function parseUpdateInfo(raw: unknown, options: ParseUpdateInfoOptions = {}): DesktopUpdateInfo {
  return parseUpdateInfoPayload(unwrapUpdaterPayload(raw), options);
}

function parseUpdateInfoPayload(value: Record<string, unknown>, options: ParseUpdateInfoOptions = {}): DesktopUpdateInfo {
  const version = typeof value.version === "string" ? value.version.trim() : "";
  const urlValue = value.url ?? value.download_url ?? value.downloadUrl;
  const url = typeof urlValue === "string" ? urlValue.trim() : "";
  if (!version) throw new Error("Updater response is missing version");
  if (!url) throw new Error("Updater response is missing url");
  const parsedUrl = new URL(url);
  if (!isAllowedUpdaterDownloadUrl(parsedUrl, options.allowInsecureHttp)) {
    throw new Error("Updater response url must be https, or http on localhost when explicitly allowed");
  }
  if (options.expectedDownloadOrigin && parsedUrl.origin !== options.expectedDownloadOrigin) {
    throw new Error("Updater response url origin does not match updater API origin");
  }
  if (options.platform && !isAllowedUpdaterPackageUrl(parsedUrl, getUpdaterPlatform(options.platform))) {
    throw new Error("Updater response url extension does not match current platform");
  }
  const sha256 = parseHexDigest(value.sha256 ?? value.checksum_sha256 ?? value.checksumSha256, 64, "sha256");
  const sha512 = parseBase64OrHexDigest(
    value.sha512 ?? value.checksum_sha512 ?? value.checksumSha512 ?? value.checksum,
    "sha512",
  );
  if (!sha256 && !sha512) {
    throw new Error("Updater response is missing package checksum");
  }
  return {
    version,
    url: parsedUrl.toString(),
    notes: typeof value.notes === "string" ? value.notes : "",
    pub_date: typeof value.pub_date === "string" ? value.pub_date : "",
    sha256,
    sha512,
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

function hasUpdateInfoFields(value: Record<string, unknown>): boolean {
  return typeof value.version === "string" ||
    typeof value.url === "string" ||
    typeof value.download_url === "string" ||
    typeof value.downloadUrl === "string";
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
  return isLocalhostHttpUrl(url);
}

export function isLocalhostHttpUrl(url: URL): boolean {
  return url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
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
  return candidate
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160) || fallback.replace(/[^A-Za-z0-9._ -]/g, "_");
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

function parseHexDigest(raw: unknown, length: number, name: string): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string" || !new RegExp(`^[a-fA-F0-9]{${length}}$`).test(raw.trim())) {
    throw new Error(`Updater response ${name} is invalid`);
  }
  return raw.trim().toLowerCase();
}

function parseBase64OrHexDigest(raw: unknown, name: string): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") throw new Error(`Updater response ${name} is invalid`);
  const value = raw.trim();
  if (/^[a-fA-F0-9]{128}$/.test(value)) return value.toLowerCase();
  if (/^[A-Za-z0-9+/]{86}==$/.test(value)) return value;
  throw new Error(`Updater response ${name} is invalid`);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersionParts(candidate);
  const base = parseVersionParts(current);
  if (!next || !base) return false;
  const length = Math.max(next.length, base.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = next[index] || 0;
    const basePart = base[index] || 0;
    if (nextPart > basePart) return true;
    if (nextPart < basePart) return false;
  }
  return false;
}

function parseVersionParts(value: string): number[] | undefined {
  const normalized = value.trim().replace(/^v/i, "");
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return undefined;
  return normalized.split(".").map((part) => Number(part));
}
