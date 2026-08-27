import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import logger from "electron-log";
import OCTO_CONFIG from "./config";
import {
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_DOWNLOADED,
  IPC_UPDATE_DOWNLOAD,
  IPC_UPDATE_ERROR,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_DOWNLOAD_PROGRESS,
  IPC_UPDATE_NOT_AVAILABLE,
} from "../shared/ipc-channels";
import {
  buildUpdaterCheckUrl,
  getMacAppBundlePath,
  getMacAppBundleName,
  getDownloadedUpdateFileName,
  getUpdaterPlatform,
  isZipUpdatePackage,
  parseUpdaterCheckResult,
  type DesktopUpdateInfo,
} from "./updateCore";

let mainWindow: BrowserWindow;
let pendingUpdateInfo: DesktopUpdateInfo | undefined;
let downloadedUpdatePath: string | undefined;
let isDownloadingUpdate = false;
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
  const checkUrl = buildUpdaterCheckUrl({
    updaterApiUrl,
    version: app.getVersion(),
  });
  logger.info(`[updater] checking ${checkUrl}`);
  const response = await net.fetch(checkUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/json",
    },
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Updater check failed with status ${response.status}`);
  }
  return parseUpdaterCheckResult(await response.json(), { platform: process.platform });
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

async function writeChunk(stream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  if (stream.write(Buffer.from(chunk))) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function downloadUpdatePackage(updateInfo: DesktopUpdateInfo): Promise<string> {
  const response = await net.fetch(updateInfo.url, {
    method: "GET",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Update download failed with status ${response.status}`);
  }
  if (!response.body) {
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
    const reader = response.body.getReader();
    const stream = fs.createWriteStream(tempPath);
    const streamFinished = new Promise<void>((resolve, reject) => {
      stream.once("finish", resolve);
      stream.once("error", reject);
    });

    sendUpdateMessage({ cmd: IPC_UPDATE_DOWNLOAD_PROGRESS, data: 0 });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        downloaded += value.byteLength;
        await writeChunk(stream, value);
        if (total > 0) {
          const percent = Math.min(99, Math.floor((downloaded / total) * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            sendUpdateMessage({ cmd: IPC_UPDATE_DOWNLOAD_PROGRESS, data: percent });
          }
        }
      }
    } finally {
      stream.end();
      reader.releaseLock();
    }

    await streamFinished;
    await fs.promises.rename(tempPath, filePath);
    completed = true;
    sendUpdateMessage({ cmd: IPC_UPDATE_DOWNLOAD_PROGRESS, data: 100 });
    return filePath;
  } catch (error) {
    if (!completed) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function openDownloadedUpdatePackage(): Promise<void> {
  if (!downloadedUpdatePath) {
    throw new Error("No downloaded update package");
  }
  if (getUpdaterPlatform() === "macos" && isZipUpdatePackage(downloadedUpdatePath)) {
    await installMacZipUpdateAndQuit(downloadedUpdatePath, pendingUpdateInfo?.version || "");
    return;
  }
  const errorMessage = await shell.openPath(downloadedUpdatePath);
  if (errorMessage) throw new Error(errorMessage);
}

async function openDownloadedUpdatePackageAndQuitIfNeeded(): Promise<void> {
  await openDownloadedUpdatePackage();
  if (downloadedUpdatePath && getUpdaterPlatform() !== "macos") {
    app.quit();
  }
}

async function installMacZipUpdateAndQuit(zipPath: string, expectedVersion: string): Promise<void> {
  const targetAppPath = getMacAppBundlePath(process.execPath);
  const expectedAppName = getMacAppBundleName(targetAppPath);
  const updateDir = path.dirname(zipPath);
  const installDir = await fs.promises.mkdtemp(path.join(updateDir, "install-"));
  const stagingPath = path.join(installDir, "staging");
  const scriptPath = path.join(installDir, "install-macos-update.sh");
  const script = `#!/bin/sh
set -eu

ZIP_PATH="$1"
TARGET_APP_PATH="$2"
STAGING_PATH="$3"
PARENT_PID="$4"
EXPECTED_BUNDLE_ID="$5"
EXPECTED_APP_NAME="$6"
EXPECTED_VERSION="$7"
INSTALL_DIR="$8"

if [ ! -f "$ZIP_PATH" ]; then
  exit 10
fi

case "$TARGET_APP_PATH" in
  *.app) ;;
  *) exit 11 ;;
esac

while kill -0 "$PARENT_PID" 2>/dev/null; do
  sleep 0.2
done

rm -rf "$STAGING_PATH"
mkdir -p "$STAGING_PATH"
/usr/bin/ditto -x -k "$ZIP_PATH" "$STAGING_PATH"

NEXT_APP_PATH="$(/usr/bin/find "$STAGING_PATH" -maxdepth 2 -name "*.app" -type d | /usr/bin/head -n 1)"
if [ -z "$NEXT_APP_PATH" ]; then
  exit 12
fi

if [ "$(/usr/bin/basename "$NEXT_APP_PATH")" != "$EXPECTED_APP_NAME" ]; then
  exit 13
fi

NEXT_INFO_PLIST="$NEXT_APP_PATH/Contents/Info.plist"
if [ ! -f "$NEXT_INFO_PLIST" ]; then
  exit 14
fi

NEXT_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$NEXT_INFO_PLIST" 2>/dev/null || true)"
if [ -n "$EXPECTED_BUNDLE_ID" ] && [ "$NEXT_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]; then
  exit 15
fi

NEXT_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$NEXT_INFO_PLIST" 2>/dev/null || true)"
if [ -n "$EXPECTED_VERSION" ] && [ "$NEXT_VERSION" != "$EXPECTED_VERSION" ]; then
  exit 16
fi

BACKUP_APP_PATH="$TARGET_APP_PATH.previous-update"
rm -rf "$BACKUP_APP_PATH"
if [ -d "$TARGET_APP_PATH" ]; then
  /bin/mv "$TARGET_APP_PATH" "$BACKUP_APP_PATH"
fi

if ! /usr/bin/ditto "$NEXT_APP_PATH" "$TARGET_APP_PATH"; then
  rm -rf "$TARGET_APP_PATH"
  if [ -d "$BACKUP_APP_PATH" ]; then
    /bin/mv "$BACKUP_APP_PATH" "$TARGET_APP_PATH"
  fi
  exit 17
fi

rm -rf "$BACKUP_APP_PATH"
/usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP_PATH" 2>/dev/null || true
/usr/bin/open "$TARGET_APP_PATH"
rm -rf "$INSTALL_DIR"
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
    installDir,
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  app.quit();
}

function checkUpdate(win: BrowserWindow) {
  mainWindow = win;
  // 接收渲染进程消息，开始检查更新
  ipcMain.on(IPC_UPDATE_CHECK, async (event, options?: { silent?: boolean }) => {
    if (!isMainWindowSender(event)) return;
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
    try {
      const updateInfo = await requestUpdateInfo();
      pendingUpdateInfo = updateInfo || undefined;
      downloadedUpdatePath = undefined;
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
    try {
      isDownloadingUpdate = true;
      downloadedUpdatePath = await downloadUpdatePackage(pendingUpdateInfo);
      sendUpdateMessage({
        cmd: IPC_UPDATE_DOWNLOADED,
        data: {
          version: pendingUpdateInfo.version,
          releaseNotes: pendingUpdateInfo.notes,
          releaseDate: pendingUpdateInfo.pub_date,
          url: pendingUpdateInfo.url,
          forceUpdate: pendingUpdateInfo.forceUpdate,
          filePath: downloadedUpdatePath,
        },
      });
      await openDownloadedUpdatePackageAndQuitIfNeeded();
    } catch (error) {
      logger.info(error);
      sendUpdateMessage({
        cmd: IPC_UPDATE_ERROR,
        data: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isDownloadingUpdate = false;
    }
  });
  // 退出并安装更新包
  ipcMain.on(IPC_UPDATE_INSTALL, async (event) => {
    if (!isMainWindowSender(event)) return;
    try {
      await openDownloadedUpdatePackageAndQuitIfNeeded();
    } catch (error) {
      logger.info(error);
      sendUpdateMessage({
        cmd: IPC_UPDATE_ERROR,
        data: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export default checkUpdate;
