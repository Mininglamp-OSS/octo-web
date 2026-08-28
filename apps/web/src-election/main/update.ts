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
  buildLinuxAppImageInstallPlan,
  buildUpdaterCheckUrl,
  buildMacInstallScript,
  buildWindowsInstallerSignatureCommand,
  getMacAppBundlePath,
  getMacAppBundleName,
  getMacExpectedMachOArch,
  getDownloadedUpdateFileName,
  getUpdaterPackageExtension,
  getUpdaterPlatform,
  isLinuxElfMachineCompatible,
  isLocalhostHttpUrl,
  isNewerVersion,
  parseLinuxElfMachine,
  parseUpdaterCheckResult,
  type DesktopUpdateInfo,
} from "./updateCore";

const DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 30_000;
const MAX_UPDATE_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow;
let pendingUpdateInfo: DesktopUpdateInfo | undefined;
let isDownloadingUpdate = false;
let updateCheckSeq = 0;
let currentDownloadController: AbortController | undefined;
let currentDownloadAbortReason: "cancelled" | "timeout" | undefined;
let pendingMacInstallError: { message: string; code: string } | undefined;
let pendingMacInstallResultRead: Promise<void> = Promise.resolve();
let updateIpcHandlersRegistered = false;
let quitUpdaterApp = () => app.quit();
const isMainWindowSender = (event: Electron.IpcMainEvent): boolean =>
  Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);

class DesktopUpdateError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    // The Electron main tsconfig still emits ES5. Native Error subclasses need
    // an explicit prototype repair there, otherwise instanceof checks fail.
    Object.setPrototypeOf(this, DesktopUpdateError.prototype);
    this.name = "DesktopUpdateError";
  }
}

// 封装更新相关的进程通信方法
const sendUpdateMessage = (opt: { cmd: string; data: any }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(opt.cmd, opt.data);
};

function sendUpdateError(message: string, code = "update-failed") {
  sendUpdateMessage({
    cmd: IPC_UPDATE_ERROR,
    data: { message, code },
  });
}

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
    throw new DesktopUpdateError("Downloaded update package checksum mismatch", "package-verification-failed");
  }
}

function getUpdateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Update download cancelled or timed out";
  return error instanceof Error ? error.message : String(error);
}

function getUpdateErrorPayload(error: unknown): { message: string; code: string } {
  if (error instanceof DesktopUpdateError) {
    return {
      message: error.message,
      code: error.code,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      message: currentDownloadAbortReason === "cancelled"
        ? "Update download cancelled"
        : "Update download timed out",
      code: currentDownloadAbortReason === "cancelled" ? "download-cancelled" : "download-timeout",
    };
  }
  return {
    message: getUpdateErrorMessage(error),
    code: "update-failed",
  };
}

function getUpdateCheckErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === "Updater response is missing package checksum" ||
    message.startsWith("Updater response sha512 is invalid") ||
    message.startsWith("Updater response sha256 is invalid")
  ) {
    return "updater-misconfigured";
  }
  return "check-failed";
}

async function downloadUpdatePackage(updateInfo: DesktopUpdateInfo): Promise<string> {
  const hashConfig = getHashConfig(updateInfo);
  const controller = new AbortController();
  currentDownloadController = controller;
  let stallTimer: NodeJS.Timeout | undefined;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        currentDownloadAbortReason = "timeout";
        controller.abort();
      }
    }, DOWNLOAD_STALL_TIMEOUT_MS);
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
    const totalHeader = response.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : 0;
    if (totalHeader && (!Number.isSafeInteger(total) || total <= 0)) {
      throw new Error("Update download content-length is invalid");
    }
    if (total > MAX_UPDATE_PACKAGE_BYTES) {
      throw new Error("Update download package is too large");
    }
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
          if (downloaded > MAX_UPDATE_PACKAGE_BYTES) {
            throw new Error("Update download package is too large");
          }
          if (total > 0 && downloaded > total) {
            throw new Error("Update download exceeded content-length");
          }
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
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (currentDownloadController === controller) currentDownloadController = undefined;
  }
}

async function openDownloadedUpdatePackage(updateInfo: DesktopUpdateInfo, filePath: string): Promise<void> {
  if (!filePath) {
    throw new Error("No downloaded update package");
  }
  const platform = getUpdaterPlatform();
  const packageExtension = getUpdaterPackageExtension(updateInfo.url, platform);
  if (platform === "macos") {
    if (packageExtension !== ".zip") throw new Error("macOS updater package must be a zip archive");
    await installMacZipUpdateAndQuit(filePath, updateInfo.version);
    return;
  }
  if (platform === "windows") {
    if (packageExtension !== ".exe") throw new Error("Windows updater package must be an exe installer");
    await verifyWindowsInstallerSignature(filePath);
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) throw new Error(errorMessage);
    return;
  }
  if (![".appimage", ".deb", ".rpm"].includes(packageExtension)) {
    throw new Error("Linux updater package extension is not supported");
  }
  if (packageExtension === ".appimage") {
    await installLinuxAppImageUpdate(filePath);
    return;
  }
  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) throw new Error(errorMessage);
}

async function installLinuxAppImageUpdate(filePath: string): Promise<void> {
  if (!process.env.APPIMAGE) {
    await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
    throw new DesktopUpdateError(
      "Linux AppImage updates require the app to be running from an AppImage package",
      "linux-appimage-path-unavailable",
    );
  }
  const plan = buildLinuxAppImageInstallPlan(process.env.APPIMAGE);
  try {
    await fs.promises.access(path.dirname(plan.targetPath), fs.constants.W_OK);
  } catch {
    throw new DesktopUpdateError(
      "Current Linux AppImage location is not writable",
      "updater-permission-denied",
    );
  }
  await verifyLinuxAppImageArchitecture(filePath);
  await fs.promises.rm(plan.stagingPath, { force: true }).catch(() => undefined);
  await fs.promises.rm(plan.backupPath, { force: true }).catch(() => undefined);
  await fs.promises.copyFile(filePath, plan.stagingPath);
  await fs.promises.chmod(plan.stagingPath, 0o755);
  try {
    await fs.promises.rename(plan.targetPath, plan.backupPath);
    await fs.promises.rename(plan.stagingPath, plan.targetPath);
  } catch (error) {
    await fs.promises.rm(plan.stagingPath, { force: true }).catch(() => undefined);
    const targetExists = await fs.promises.stat(plan.targetPath).then(() => true, () => false);
    const backupExists = await fs.promises.stat(plan.backupPath).then(() => true, () => false);
    if (!targetExists && backupExists) {
      await fs.promises.rename(plan.backupPath, plan.targetPath).catch(() => undefined);
    }
    throw error;
  }
  app.relaunch({ execPath: plan.targetPath });
  await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
}

async function verifyLinuxAppImageArchitecture(filePath: string): Promise<void> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const machine = parseLinuxElfMachine(header.subarray(0, bytesRead));
    if (!isLinuxElfMachineCompatible(machine, process.arch)) {
      throw new DesktopUpdateError(
        `Linux AppImage architecture does not match this ${process.arch} client`,
        "updater-architecture-mismatch",
      );
    }
  } finally {
    await handle.close();
  }
}

async function verifyWindowsInstallerSignature(filePath: string): Promise<void> {
  const expectedPublisher = OCTO_CONFIG.updaterWindowsPublisherName;
  if (!expectedPublisher) {
    throw new DesktopUpdateError("Windows update signing publisher is not configured", "updater-misconfigured");
  }
  const command = buildWindowsInstallerSignatureCommand();
  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ], {
      windowsHide: true,
      env: {
        ...process.env,
        OCTO_UPDATE_INSTALLER_PATH: filePath,
        OCTO_UPDATE_WINDOWS_PUBLISHER_NAME: expectedPublisher,
      },
    });
  } catch (error) {
    const rawExitCode = (error as { code?: unknown }).code;
    const exitCode = typeof rawExitCode === "number"
      ? rawExitCode
      : undefined;
    const code = exitCode === 10 || exitCode === 11 || exitCode === 12
      ? "package-verification-failed"
      : "updater-misconfigured";
    throw new DesktopUpdateError(
      error instanceof Error ? error.message : "Windows update package signature verification failed",
      code,
    );
  }
}

async function openDownloadedUpdatePackageAndQuitIfNeeded(updateInfo: DesktopUpdateInfo, filePath: string): Promise<void> {
  await openDownloadedUpdatePackage(updateInfo, filePath);
  if (getUpdaterPlatform() !== "macos") {
    quitUpdaterApp();
  }
}

async function installMacZipUpdateAndQuit(zipPath: string, expectedVersion: string): Promise<void> {
  const expectedTeamId = OCTO_CONFIG.updaterCodeSigningTeamId;
  if (!expectedTeamId) {
    throw new DesktopUpdateError("macOS update signing Team ID is not configured", "updater-misconfigured");
  }
  const targetAppPath = getMacAppBundlePath(process.execPath);
  const expectedAppName = getMacAppBundleName(targetAppPath);
  const updateDir = path.dirname(zipPath);
  try {
    await fs.promises.access(path.dirname(targetAppPath), fs.constants.W_OK);
  } catch {
    throw new DesktopUpdateError(
      "Current macOS installation location is not writable",
      "updater-permission-denied",
    );
  }
  let expectedAppArch: string;
  try {
    expectedAppArch = getMacExpectedMachOArch(process.arch);
  } catch (error) {
    throw new DesktopUpdateError(
      error instanceof Error ? error.message : "Unsupported macOS updater architecture",
      "updater-architecture-mismatch",
    );
  }
  const installDir = await fs.promises.mkdtemp(path.join(updateDir, "install-"));
  const stagingPath = path.join(installDir, "staging");
  const resultPath = path.join(updateDir, "last-macos-update-result.txt");
  const logPath = path.join(updateDir, "last-macos-update.log");
  const scriptPath = path.join(installDir, "install-macos-update.sh");
  await fs.promises.rm(resultPath, { force: true }).catch(() => undefined);
  const script = buildMacInstallScript();
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
    "/bin/ps",
    expectedAppArch,
  ], {
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  quitUpdaterApp();
}

async function surfacePendingMacInstallResult(): Promise<void> {
  if (process.platform !== "darwin") return;
  const resultPath = path.join(app.getPath("userData"), "updates", "last-macos-update-result.txt");
  let code = "";
  try {
    code = (await fs.promises.readFile(resultPath, "utf8")).trim();
  } catch {
    return;
  }
  if (!code) return;
  pendingMacInstallError = {
    message: `macOS update installer failed with code ${code}. See ${path.join(app.getPath("userData"), "updates", "last-macos-update.log")}`,
    code: "macos-install-failed",
  };
}

async function flushPendingMacInstallResult(): Promise<void> {
  if (!pendingMacInstallError) return;
  sendUpdateMessage({ cmd: IPC_UPDATE_ERROR, data: pendingMacInstallError });
  pendingMacInstallError = undefined;
  if (process.platform !== "darwin") return;
  const resultPath = path.join(app.getPath("userData"), "updates", "last-macos-update-result.txt");
  await fs.promises.rm(resultPath, { force: true }).catch(() => undefined);
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
      lower.endsWith(".processes") ||
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

async function reconcileStaleMacInstallArtifacts(): Promise<void> {
  if (process.platform !== "darwin") return;
  let targetAppPath = "";
  try {
    targetAppPath = getMacAppBundlePath(process.execPath);
  } catch {
    return;
  }
  const backupPath = `${targetAppPath}.previous-update`;
  const inProgressPath = `${targetAppPath}.update-in-progress`;
  const [targetExists, backupStat] = await Promise.all([
    fs.promises.stat(targetAppPath).then(() => true, () => false),
    fs.promises.stat(backupPath).catch(() => undefined),
  ]);
  const inProgressStat = await fs.promises.stat(inProgressPath).catch(() => undefined);
  if (targetExists && backupStat && backupStat.ctimeMs < Date.now() - 24 * 60 * 60 * 1000) {
    await fs.promises.rm(backupPath, { recursive: true, force: true }).catch((error) => {
      logger.warn(`[updater] failed to cleanup stale macOS backup app bundle: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (inProgressStat && inProgressStat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
    await fs.promises.rm(inProgressPath, { recursive: true, force: true }).catch((error) => {
      logger.warn(`[updater] failed to cleanup stale macOS staged app bundle: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function reconcileStaleLinuxAppImageArtifacts(): Promise<void> {
  if (process.platform !== "linux" || !process.env.APPIMAGE) return;
  let plan;
  try {
    plan = buildLinuxAppImageInstallPlan(process.env.APPIMAGE);
  } catch {
    return;
  }
  const [targetExists, backupStat, stagingStat] = await Promise.all([
    fs.promises.stat(plan.targetPath).then(() => true, () => false),
    fs.promises.stat(plan.backupPath).catch(() => undefined),
    fs.promises.stat(plan.stagingPath).catch(() => undefined),
  ]);
  if (targetExists && backupStat) {
    await fs.promises.rm(plan.backupPath, { force: true }).catch((error) => {
      logger.warn(`[updater] failed to cleanup stale Linux AppImage backup: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (stagingStat && stagingStat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
    await fs.promises.rm(plan.stagingPath, { force: true }).catch((error) => {
      logger.warn(`[updater] failed to cleanup stale Linux AppImage staging file: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

function checkUpdate(win: BrowserWindow, options?: { quitApp?: () => void }) {
  mainWindow = win;
  if (options?.quitApp) quitUpdaterApp = options.quitApp;
  pendingMacInstallResultRead = surfacePendingMacInstallResult().catch((error) => {
    logger.warn(`[updater] failed to read pending macOS install result: ${error instanceof Error ? error.message : String(error)}`);
  });
  void cleanupStaleUpdateArtifacts();
  void reconcileStaleMacInstallArtifacts();
  void reconcileStaleLinuxAppImageArtifacts();
  if (updateIpcHandlersRegistered) return;
  updateIpcHandlersRegistered = true;
  // 接收渲染进程消息，开始检查更新
  ipcMain.on(IPC_UPDATE_CHECK, async (event, options?: { silent?: boolean }) => {
    if (!isMainWindowSender(event)) return;
    await pendingMacInstallResultRead;
    await flushPendingMacInstallResult();
    if (isDownloadingUpdate) {
      if (!options?.silent) {
        sendUpdateError("Update download is already in progress", "download-in-progress");
      }
      return;
    }
    if (!OCTO_CONFIG.updaterApiUrl) {
      logger.info("[updater] updater API URL is not configured; skipping update check");
      if (!options?.silent) {
        sendUpdateError("Updater API URL is not configured", "updater-api-not-configured");
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
      if (seq === updateCheckSeq && !isDownloadingUpdate && !options?.silent) {
        sendUpdateError(error instanceof Error ? error.message : String(error), getUpdateCheckErrorCode(error));
      }
    }
  });

  // 触发更新
  ipcMain.on(IPC_UPDATE_DOWNLOAD, async (event) => {
    if (!isMainWindowSender(event)) return;
    if (isDownloadingUpdate) return;
    if (!pendingUpdateInfo?.url) {
      sendUpdateError("No pending update download URL", "no-pending-update");
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
        data: getUpdateErrorPayload(error),
      });
    } finally {
      isDownloadingUpdate = false;
      currentDownloadAbortReason = undefined;
    }
  });
  ipcMain.on(IPC_UPDATE_CANCEL_DOWNLOAD, (event) => {
    if (!isMainWindowSender(event)) return;
    if (currentDownloadController && !currentDownloadController.signal.aborted) {
      currentDownloadAbortReason = "cancelled";
      currentDownloadController.abort();
    }
  });
}

export default checkUpdate;
