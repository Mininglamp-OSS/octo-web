import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import logger from "electron-log";
import OCTO_CONFIG from "./config";
import {
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_CANCEL_DOWNLOAD,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_DOWNLOADED,
  IPC_UPDATE_DOWNLOAD,
  IPC_UPDATE_ERROR,
  IPC_UPDATE_DOWNLOAD_PROGRESS,
  IPC_UPDATE_NOT_AVAILABLE,
} from "../shared/ipc-channels";
import {
  buildUpdaterCheckUrl,
  getMacAppBundlePath,
  getMacAppBundleName,
  getDownloadedUpdateFileName,
  getUpdaterPlatform,
  isLocalhostHttpUrl,
  isNewerVersion,
  isZipUpdatePackage,
  parseUpdaterCheckResult,
  type DesktopUpdateInfo,
} from "./updateCore";

const DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow;
let pendingUpdateInfo: DesktopUpdateInfo | undefined;
let isDownloadingUpdate = false;
let updateCheckSeq = 0;
let currentDownloadController: AbortController | undefined;
const isMainWindowSender = (event: Electron.IpcMainEvent): boolean =>
  Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
// 封装更新相关的进程通信方法
const sendUpdateMessage = (opt: { cmd: string; data: any }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(opt.cmd, opt.data);
};

async function requestUpdateInfo(): Promise<DesktopUpdateInfo | null> {
  const updaterApiUrl = OCTO_CONFIG.updaterApiUrl;
  if (!updaterApiUrl) {
    throw new Error("Updater API URL is not configured");
  }
  const updaterBaseUrl = new URL(updaterApiUrl);
  const checkUrl = buildUpdaterCheckUrl({
    updaterApiUrl,
    version: app.getVersion(),
  });
  logger.info(`[updater] checking ${checkUrl}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const response = await net.fetch(checkUrl, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    signal: controller.signal,
    headers: {
      Accept: "application/json",
    },
  }).finally(() => clearTimeout(timeout));
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Updater check failed with status ${response.status}`);
  }
  const updateInfo = parseUpdaterCheckResult(await response.json(), {
    allowInsecureHttp: isLocalhostHttpUrl(updaterBaseUrl),
    expectedDownloadOrigin: updaterBaseUrl.origin,
    platform: process.platform,
  });
  if (!updateInfo || isNewerVersion(updateInfo.version, app.getVersion())) return updateInfo;
  logger.info(`[updater] ignoring non-newer version ${updateInfo.version}; current=${app.getVersion()}`);
  return null;
}

function sendUpdateAvailable(updateInfo: DesktopUpdateInfo) {
  sendUpdateMessage({
    cmd: IPC_UPDATE_AVAILABLE,
    data: {
      version: updateInfo.version,
      releaseNotes: updateInfo.notes,
      releaseDate: updateInfo.pub_date,
      url: updateInfo.url,
      forceUpdate: updateInfo.forceUpdate,
    },
  });
}

function sendDownloadProgress(data: number | { percent: number; downloadedBytes?: number; totalBytes?: number }) {
  sendUpdateMessage({ cmd: IPC_UPDATE_DOWNLOAD_PROGRESS, data });
}

async function writeChunk(stream: fs.WriteStream, chunk: Uint8Array, streamErrorPromise: Promise<never>): Promise<void> {
  if (stream.write(Buffer.from(chunk))) return;
  let onDrain: (() => void) | undefined;
  const drainPromise = new Promise<void>((resolve) => {
    onDrain = resolve;
    stream.once("drain", onDrain);
  });
  try {
    await Promise.race([drainPromise, streamErrorPromise]);
  } finally {
    if (onDrain) stream.removeListener("drain", onDrain);
  }
}

function finishStream(stream: fs.WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.removeListener("error", onError);
      stream.removeListener("finish", onFinish);
    };
    stream.once("error", onError);
    stream.once("finish", onFinish);
    stream.end();
  });
}

function getHashConfig(updateInfo: DesktopUpdateInfo): {
  algorithm: "sha512" | "sha256";
  encoding: "base64" | "hex";
  expected: string;
} {
  if (updateInfo.sha512) {
    return {
      algorithm: "sha512",
      encoding: /^[a-fA-F0-9]{128}$/.test(updateInfo.sha512) ? "hex" : "base64",
      expected: updateInfo.sha512,
    };
  }
  if (updateInfo.sha256) {
    return { algorithm: "sha256", encoding: "hex", expected: updateInfo.sha256 };
  }
  throw new Error("Updater response is missing package checksum");
}

function verifyDownloadedPackageHash(expected: string, actualDigest: string, encoding: "base64" | "hex") {
  const normalizedExpected = encoding === "hex" ? expected.toLowerCase() : expected;
  const normalizedActual = encoding === "hex" ? actualDigest.toLowerCase() : actualDigest;
  if (normalizedActual !== normalizedExpected) {
    throw new Error("Downloaded update package checksum mismatch");
  }
}

function getUpdateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Update download cancelled or timed out";
  return error instanceof Error ? error.message : String(error);
}

async function downloadUpdatePackage(updateInfo: DesktopUpdateInfo): Promise<string> {
  const hashConfig = getHashConfig(updateInfo);
  const controller = new AbortController();
  currentDownloadController = controller;
  let stallTimer: NodeJS.Timeout | undefined;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
  };
  resetStallTimer();
  let response: Awaited<ReturnType<typeof net.fetch>>;
  try {
    response = await net.fetch(updateInfo.url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    if (stallTimer) clearTimeout(stallTimer);
    if (currentDownloadController === controller) currentDownloadController = undefined;
    throw error;
  }
  if (!response.ok) {
    if (stallTimer) clearTimeout(stallTimer);
    if (currentDownloadController === controller) currentDownloadController = undefined;
    throw new Error(`Update download failed with status ${response.status}`);
  }
  if (!response.body) {
    if (stallTimer) clearTimeout(stallTimer);
    if (currentDownloadController === controller) currentDownloadController = undefined;
    throw new Error("Update download response has no body");
  }

  const platform = getUpdaterPlatform();
  const updateDir = path.join(app.getPath("userData"), "updates");
  await fs.promises.mkdir(updateDir, { recursive: true });
  const filePath = path.join(updateDir, getDownloadedUpdateFileName(updateInfo.url, updateInfo.version, platform));
  const tempPath = `${filePath}.download`;
  await fs.promises.rm(tempPath, { force: true });

  let completed = false;
  try {
    const total = Number(response.headers.get("content-length") || 0);
    let downloaded = 0;
    let lastPercent = -1;
    const hash = crypto.createHash(hashConfig.algorithm);
    const reader = response.body.getReader();
    const stream = fs.createWriteStream(tempPath);
    let streamError: Error | undefined;
    let rejectStreamError: ((error: Error) => void) | undefined;
    const streamErrorPromise = new Promise<never>((_, reject) => {
      rejectStreamError = reject;
    });
    streamErrorPromise.catch(() => undefined);
    const onStreamError = (error: Error) => {
      streamError = error;
      rejectStreamError?.(error);
    };
    stream.on("error", onStreamError);

    try {
      sendDownloadProgress(total > 0 ? 0 : { percent: -1, downloadedBytes: 0 });
      try {
        for (;;) {
          if (streamError) throw streamError;
          resetStallTimer();
          const { done, value } = await Promise.race([reader.read(), streamErrorPromise]);
          if (streamError) throw streamError;
          if (done) break;
          if (!value) continue;
          downloaded += value.byteLength;
          hash.update(value);
          await writeChunk(stream, value, streamErrorPromise);
          if (streamError) throw streamError;
          if (total > 0) {
            const percent = Math.min(99, Math.floor((downloaded / total) * 100));
            if (percent !== lastPercent) {
              lastPercent = percent;
              sendDownloadProgress(percent);
            }
          } else {
            sendDownloadProgress({ percent: -1, downloadedBytes: downloaded });
          }
        }
      } catch (error) {
        stream.destroy();
        throw error;
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
        if (currentDownloadController === controller) currentDownloadController = undefined;
        reader.releaseLock();
      }

      if (streamError) throw streamError;
      await finishStream(stream);
      if (total > 0 && downloaded !== total) {
        throw new Error("Update download ended before content-length was reached");
      }
      verifyDownloadedPackageHash(hashConfig.expected, hash.digest(hashConfig.encoding), hashConfig.encoding);
      if (platform === "linux" && filePath.toLowerCase().endsWith(".appimage")) {
        await fs.promises.chmod(tempPath, 0o755);
      }
      await fs.promises.rename(tempPath, filePath);
      completed = true;
      sendDownloadProgress({ percent: 100, downloadedBytes: downloaded, totalBytes: total > 0 ? total : undefined });
      return filePath;
    } finally {
      stream.removeListener("error", onStreamError);
    }
  } catch (error) {
    if (!completed) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function openDownloadedUpdatePackage(updateInfo: DesktopUpdateInfo, filePath: string): Promise<void> {
  if (!filePath) {
    throw new Error("No downloaded update package");
  }
  if (getUpdaterPlatform() === "macos" && isZipUpdatePackage(filePath)) {
    await installMacZipUpdateAndQuit(filePath, updateInfo.version);
    return;
  }
  if (process.platform === "win32" && filePath.toLowerCase().endsWith(".exe")) {
    await verifyWindowsInstallerSignature(filePath);
  }
  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) throw new Error(errorMessage);
}

async function verifyWindowsInstallerSignature(filePath: string): Promise<void> {
  const expectedPublisher = OCTO_CONFIG.updaterWindowsPublisherName;
  if (!expectedPublisher) {
    throw new Error("Windows update signing publisher is not configured");
  }
  const command = [
    "& { param([string]$Path, [string]$ExpectedPublisher)",
    "$signature = Get-AuthenticodeSignature -LiteralPath $Path",
    "if ($signature.Status -ne 'Valid') { exit 10 }",
    "$subject = $signature.SignerCertificate.Subject",
    "$match = [regex]::Match($subject, '(?:^|,\\s*)CN=([^,]+)')",
    "if (!$match.Success) { exit 11 }",
    "if ($match.Groups[1].Value -ne $ExpectedPublisher) { exit 11 }",
    "}",
  ].join("; ");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
    filePath,
    expectedPublisher,
  ], { windowsHide: true });
}

async function openDownloadedUpdatePackageAndQuitIfNeeded(updateInfo: DesktopUpdateInfo, filePath: string): Promise<void> {
  await openDownloadedUpdatePackage(updateInfo, filePath);
  if (getUpdaterPlatform() !== "macos") {
    app.quit();
  }
}

async function installMacZipUpdateAndQuit(zipPath: string, expectedVersion: string): Promise<void> {
  const expectedTeamId = OCTO_CONFIG.updaterCodeSigningTeamId;
  if (!expectedTeamId) {
    throw new Error("macOS update signing Team ID is not configured");
  }
  const targetAppPath = getMacAppBundlePath(process.execPath);
  const expectedAppName = getMacAppBundleName(targetAppPath);
  const updateDir = path.dirname(zipPath);
  await fs.promises.access(path.dirname(targetAppPath), fs.constants.W_OK);
  const installDir = await fs.promises.mkdtemp(path.join(updateDir, "install-"));
  const stagingPath = path.join(installDir, "staging");
  const resultPath = path.join(updateDir, "last-macos-update-result.txt");
  const logPath = path.join(updateDir, "last-macos-update.log");
  const scriptPath = path.join(installDir, "install-macos-update.sh");
  await fs.promises.rm(resultPath, { force: true }).catch(() => undefined);
  const script = `#!/bin/sh
set -eu

ZIP_PATH="$1"
TARGET_APP_PATH="$2"
STAGING_PATH="$3"
PARENT_PID="$4"
EXPECTED_BUNDLE_ID="$5"
EXPECTED_APP_NAME="$6"
EXPECTED_VERSION="$7"
EXPECTED_TEAM_ID="$8"
INSTALL_DIR="$9"
RESULT_PATH="\${10}"
LOG_PATH="\${11}"

exec >> "$LOG_PATH" 2>&1
echo "macOS update helper started at $(date)"

cleanup() {
  rm -rf "$INSTALL_DIR"
}

fail() {
  CODE="$1"
  printf "%s\\n" "$CODE" > "$RESULT_PATH" 2>/dev/null || true
  if [ -d "$TARGET_APP_PATH" ]; then
    /usr/bin/open "$TARGET_APP_PATH" >/dev/null 2>&1 || true
  fi
  exit "$CODE"
}

wait_until_not_running() {
  RUNNING_CHECK=0
  while /bin/ps -axo command= | /usr/bin/grep -F "$TARGET_APP_PATH/Contents/MacOS/" >/dev/null 2>&1; do
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

while kill -0 "$PARENT_PID" 2>/dev/null; do
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
rm -rf "$BACKUP_APP_PATH"
if [ -d "$TARGET_APP_PATH" ]; then
  /bin/mv "$TARGET_APP_PATH" "$BACKUP_APP_PATH" || fail 19
fi

if ! /usr/bin/ditto "$NEXT_APP_PATH" "$TARGET_APP_PATH"; then
  rm -rf "$TARGET_APP_PATH"
  if [ -d "$BACKUP_APP_PATH" ]; then
    /bin/mv "$BACKUP_APP_PATH" "$TARGET_APP_PATH"
  fi
  fail 19
fi

rm -rf "$BACKUP_APP_PATH"
rm -f "$RESULT_PATH"
rm -f "$ZIP_PATH"
/usr/bin/open "$TARGET_APP_PATH"
`;
  await fs.promises.writeFile(scriptPath, script, { mode: 0o700 });
  const child = spawn("/bin/sh", [
    scriptPath,
    zipPath,
    targetAppPath,
    stagingPath,
    String(process.pid),
    OCTO_CONFIG.appId,
    expectedAppName,
    expectedVersion,
    expectedTeamId,
    installDir,
    resultPath,
    logPath,
  ], {
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  app.quit();
}

async function surfacePendingMacInstallResult(): Promise<void> {
  if (process.platform !== "darwin") return;
  const resultPath = path.join(app.getPath("userData"), "updates", "last-macos-update-result.txt");
  let code = "";
  try {
    code = (await fs.promises.readFile(resultPath, "utf8")).trim();
    await fs.promises.rm(resultPath, { force: true });
  } catch {
    return;
  }
  if (!code) return;
  setTimeout(() => {
    sendUpdateMessage({
      cmd: IPC_UPDATE_ERROR,
      data: `macOS update installer failed with code ${code}. See ${path.join(app.getPath("userData"), "updates", "last-macos-update.log")}`,
    });
  }, 1500);
}

async function cleanupStaleUpdateArtifacts(): Promise<void> {
  const updateDir = path.join(app.getPath("userData"), "updates");
  const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(updateDir);
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const lower = entry.toLowerCase();
    if (
      lower.endsWith(".download") ||
      lower.endsWith(".zip") ||
      lower.endsWith(".dmg") ||
      lower.endsWith(".exe") ||
      lower.endsWith(".appimage") ||
      lower.startsWith("install-")
    ) {
      const target = path.join(updateDir, entry);
      const stat = await fs.promises.stat(target).catch(() => undefined);
      if (stat && stat.mtimeMs < staleBefore) {
        await fs.promises.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }));
}

function checkUpdate(win: BrowserWindow) {
  mainWindow = win;
  void surfacePendingMacInstallResult();
  void cleanupStaleUpdateArtifacts();
  // 接收渲染进程消息，开始检查更新
  ipcMain.on(IPC_UPDATE_CHECK, async (event, options?: { silent?: boolean }) => {
    if (!isMainWindowSender(event)) return;
    if (isDownloadingUpdate) {
      if (!options?.silent) {
        sendUpdateMessage({
          cmd: IPC_UPDATE_ERROR,
          data: "Update download is already in progress",
        });
      }
      return;
    }
    if (!OCTO_CONFIG.updaterApiUrl) {
      logger.info("[updater] updater API URL is not configured; skipping update check");
      if (!options?.silent) {
        sendUpdateMessage({
          cmd: IPC_UPDATE_ERROR,
          data: "Updater API URL is not configured",
        });
      }
      return;
    }
    const seq = updateCheckSeq + 1;
    updateCheckSeq = seq;
    try {
      const updateInfo = await requestUpdateInfo();
      if (seq !== updateCheckSeq || isDownloadingUpdate) return;
      pendingUpdateInfo = updateInfo || undefined;
      if (updateInfo) sendUpdateAvailable(updateInfo);
      else if (!options?.silent) sendUpdateMessage({ cmd: IPC_UPDATE_NOT_AVAILABLE, data: {} });
    } catch (error) {
      logger.info(error);
      if (!options?.silent) {
        sendUpdateMessage({
          cmd: IPC_UPDATE_ERROR,
          data: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  // 触发更新
  ipcMain.on(IPC_UPDATE_DOWNLOAD, async (event) => {
    if (!isMainWindowSender(event)) return;
    if (isDownloadingUpdate) return;
    if (!pendingUpdateInfo?.url) {
      sendUpdateMessage({
        cmd: IPC_UPDATE_ERROR,
        data: "No pending update download URL",
      });
      return;
    }
    const updateInfo = pendingUpdateInfo;
    try {
      isDownloadingUpdate = true;
      const filePath = await downloadUpdatePackage(updateInfo);
      sendUpdateMessage({
        cmd: IPC_UPDATE_DOWNLOADED,
        data: {
          version: updateInfo.version,
          releaseNotes: updateInfo.notes,
          releaseDate: updateInfo.pub_date,
          url: updateInfo.url,
          forceUpdate: updateInfo.forceUpdate,
          filePath,
        },
      });
      await openDownloadedUpdatePackageAndQuitIfNeeded(updateInfo, filePath);
    } catch (error) {
      logger.info(error);
      sendUpdateMessage({
        cmd: IPC_UPDATE_ERROR,
        data: getUpdateErrorMessage(error),
      });
    } finally {
      isDownloadingUpdate = false;
    }
  });
  ipcMain.on(IPC_UPDATE_CANCEL_DOWNLOAD, (event) => {
    if (!isMainWindowSender(event)) return;
    currentDownloadController?.abort();
  });
}

export default checkUpdate;
