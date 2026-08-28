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

export interface LinuxAppImageInstallPlan {
  targetPath: string;
  stagingPath: string;
  backupPath: string;
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
  const pathname = decodeUrlPathname(url).toLowerCase();
  if (platform === "macos") return pathname.endsWith(".zip");
  if (platform === "windows") return pathname.endsWith(".exe");
  return pathname.endsWith(".appimage") || pathname.endsWith(".deb") || pathname.endsWith(".rpm");
}

export function getUpdaterPackageExtension(url: string, platform: UpdaterPlatform): string {
  const parsedUrl = new URL(url);
  const pathname = decodeUrlPathname(parsedUrl).toLowerCase();
  const allowedExtensions = platform === "macos"
    ? [".zip"]
    : platform === "windows"
      ? [".exe"]
      : [".appimage", ".deb", ".rpm"];
  const extension = allowedExtensions.find((item) => pathname.endsWith(item));
  if (!extension) {
    throw new Error("Updater package extension does not match current platform");
  }
  return extension;
}

function decodeUrlPathname(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    throw new Error("Updater response url path is malformed");
  }
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
  let extension = platform === "windows" ? ".exe" : platform === "macos" ? ".zip" : ".AppImage";
  try {
    extension = getUpdaterPackageExtension(url, platform);
    const pathname = new URL(url).pathname;
    name = pathname.endsWith("/") ? "" : decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    name = "";
  }
  const fallback = `OCTO-${version}${extension}`;
  const candidate = name || fallback;
  const sanitized = candidate
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "");
  const fallbackName = fallback.replace(/[^A-Za-z0-9._ -]/g, "_");
  const source = sanitized || fallbackName;
  const lowerSource = source.toLowerCase();
  const lowerExtension = extension.toLowerCase();
  const sourceWithExtension = lowerSource.endsWith(lowerExtension) ? source : fallbackName;
  const fallbackStem = fallbackName.slice(0, -extension.length).replace(/[. ]+$/, "") || "OCTO";
  const stem = sourceWithExtension.slice(0, -extension.length).replace(/[. ]+$/, "") || fallbackStem;
  const safeStem = stem.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/, "") || "OCTO";
  return `${safeStem.slice(0, Math.max(1, 160 - extension.length))}${extension}`;
}

export function buildLinuxAppImageInstallPlan(currentAppImagePath: string): LinuxAppImageInstallPlan {
  const targetPath = currentAppImagePath.trim();
  if (!targetPath) {
    throw new Error("Running AppImage path is not available");
  }
  if (!targetPath.toLowerCase().endsWith(".appimage")) {
    throw new Error("Running AppImage path must end with .AppImage");
  }
  return {
    targetPath,
    stagingPath: `${targetPath}.update-in-progress`,
    backupPath: `${targetPath}.previous-update`,
  };
}

export function buildMacInstallScript(): string {
  return `#!/bin/sh
set -eu

ZIP_PATH="$1"
TARGET_APP_PATH="$2"
INSTALL_TARGET_TMP_PATH="$TARGET_APP_PATH.update-in-progress"
STAGING_PATH="$3"
PARENT_PID="$4"
EXPECTED_BUNDLE_ID="$5"
EXPECTED_APP_NAME="$6"
EXPECTED_VERSION="$7"
EXPECTED_TEAM_ID="$8"
INSTALL_DIR="$9"
RESULT_PATH="\${10}"
LOG_PATH="\${11}"
PS_BIN="\${12:-/bin/ps}"

if ! : >> "$LOG_PATH" 2>/dev/null; then
  LOG_PATH=/dev/null
fi
exec >> "$LOG_PATH" 2>&1
echo "macOS update helper started at $(date)"

cleanup() {
  rm -rf "$INSTALL_DIR"
  rm -f "$RESULT_PATH.processes"
}

fail() {
  CODE="$1"
  printf "%s\\n" "$CODE" > "$RESULT_PATH" 2>/dev/null || true
  rm -rf "$INSTALL_TARGET_TMP_PATH" >/dev/null 2>&1 || true
  if [ -d "$TARGET_APP_PATH" ]; then
    /usr/bin/open "$TARGET_APP_PATH" >/dev/null 2>&1 || true
  fi
  exit "$CODE"
}

wait_until_not_running() {
  RUNNING_CHECK=0
  PROCESS_LIST_PATH="$RESULT_PATH.processes"
  OCTO_WAIT_PREFIX="$TARGET_APP_PATH/Contents/MacOS/"
  export OCTO_WAIT_PREFIX
  while :; do
    "$PS_BIN" -axww -o command= > "$PROCESS_LIST_PATH" || fail 20
    set +e
    /usr/bin/awk 'BEGIN { prefix = ENVIRON["OCTO_WAIT_PREFIX"] } index($0, prefix) == 1 { found = 1; exit } END { exit found ? 0 : 1 }' "$PROCESS_LIST_PATH"
    AWK_STATUS=$?
    set -e
    if [ "$AWK_STATUS" -eq 1 ]; then
      break
    fi
    if [ "$AWK_STATUS" -ne 0 ]; then
      fail 20
    fi
    RUNNING_CHECK=$((RUNNING_CHECK + 1))
    if [ "$RUNNING_CHECK" -ge 150 ]; then
      fail 20
    fi
    sleep 0.2
  done
}

trap cleanup EXIT

if [ ! -f "$ZIP_PATH" ]; then
  fail 10
fi

case "$TARGET_APP_PATH" in
  *.app) ;;
  *) fail 11 ;;
esac

PARENT_WAIT=0
while kill -0 "$PARENT_PID" 2>/dev/null; do
  PARENT_WAIT=$((PARENT_WAIT + 1))
  if [ "$PARENT_WAIT" -ge 3000 ]; then
    fail 23
  fi
  sleep 0.2
done

wait_until_not_running

rm -rf "$STAGING_PATH" || fail 12
mkdir -p "$STAGING_PATH" || fail 12
/usr/bin/ditto -x -k "$ZIP_PATH" "$STAGING_PATH" || fail 12

NEXT_APP_PATH="$(/usr/bin/find "$STAGING_PATH" -maxdepth 2 -name "*.app" -type d | /usr/bin/head -n 1)"
if [ -z "$NEXT_APP_PATH" ]; then
  fail 12
fi

if [ "$(/usr/bin/basename "$NEXT_APP_PATH")" != "$EXPECTED_APP_NAME" ]; then
  fail 13
fi

NEXT_INFO_PLIST="$NEXT_APP_PATH/Contents/Info.plist"
if [ ! -f "$NEXT_INFO_PLIST" ]; then
  fail 14
fi

NEXT_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$NEXT_INFO_PLIST" 2>/dev/null || true)"
if [ -n "$EXPECTED_BUNDLE_ID" ] && [ "$NEXT_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]; then
  fail 15
fi

NEXT_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$NEXT_INFO_PLIST" 2>/dev/null || true)"
NORMALIZED_NEXT_VERSION="$(printf "%s" "$NEXT_VERSION" | /usr/bin/sed 's/^[vV]//')"
NORMALIZED_EXPECTED_VERSION="$(printf "%s" "$EXPECTED_VERSION" | /usr/bin/sed 's/^[vV]//')"
if [ -n "$NORMALIZED_EXPECTED_VERSION" ] && [ "$NORMALIZED_NEXT_VERSION" != "$NORMALIZED_EXPECTED_VERSION" ]; then
  fail 16
fi

if ! /usr/bin/codesign --verify --deep --strict "$NEXT_APP_PATH" >/dev/null 2>&1; then
  fail 17
fi

NEXT_TEAM_ID="$(/usr/bin/codesign -dv "$NEXT_APP_PATH" 2>&1 | /usr/bin/awk -F= '/^TeamIdentifier=/ {print $2; exit}')"
if [ "$NEXT_TEAM_ID" != "$EXPECTED_TEAM_ID" ]; then
  fail 18
fi

wait_until_not_running

BACKUP_APP_PATH="$TARGET_APP_PATH.previous-update"
rm -rf "$INSTALL_TARGET_TMP_PATH"
if ! /usr/bin/ditto "$NEXT_APP_PATH" "$INSTALL_TARGET_TMP_PATH"; then
  rm -rf "$INSTALL_TARGET_TMP_PATH"
  fail 19
fi

wait_until_not_running

rm -rf "$BACKUP_APP_PATH"
if [ -d "$TARGET_APP_PATH" ]; then
  /bin/mv "$TARGET_APP_PATH" "$BACKUP_APP_PATH" || fail 21
fi

if ! /bin/mv "$INSTALL_TARGET_TMP_PATH" "$TARGET_APP_PATH"; then
  rm -rf "$INSTALL_TARGET_TMP_PATH" || true
  rm -rf "$TARGET_APP_PATH" || true
  if [ -d "$BACKUP_APP_PATH" ]; then
    /bin/mv "$BACKUP_APP_PATH" "$TARGET_APP_PATH" || true
  fi
  fail 22
fi

rm -rf "$BACKUP_APP_PATH"
rm -f "$RESULT_PATH"
rm -f "$ZIP_PATH"
/usr/bin/open "$TARGET_APP_PATH"
`;
}

export function buildWindowsInstallerSignatureCommand(): string {
  return [
    "$Path = $env:OCTO_UPDATE_INSTALLER_PATH",
    "$ExpectedPublisher = $env:OCTO_UPDATE_WINDOWS_PUBLISHER_NAME",
    "if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($ExpectedPublisher)) { exit 12 }",
    "$signature = Get-AuthenticodeSignature -LiteralPath $Path",
    "if ($signature.Status -ne 'Valid') { exit 10 }",
    "$subject = $signature.SignerCertificate.Subject",
    "$match = [regex]::Match($subject, '(?:^|,\\s*)CN=([^,]+)')",
    "if (!$match.Success) { exit 11 }",
    "if ($match.Groups[1].Value -ne $ExpectedPublisher) { exit 11 }",
  ].join("; ");
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
