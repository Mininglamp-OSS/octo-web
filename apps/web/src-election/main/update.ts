import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import logger from "electron-log";
import path from "path";
import OCTO_CONFIG from "./config";
import {
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_DOWNLOADED,
  IPC_UPDATE_DOWNLOAD,
  IPC_UPDATE_DOWNLOAD_PROGRESS,
  IPC_UPDATE_ERROR,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_NOT_AVAILABLE,
} from "../shared/ipc-channels";
const feedUrl = `${OCTO_CONFIG.updateUrl}v1/common/pcupdater/`;

let mainWindow: BrowserWindow;
const isMainWindowSender = (event: Electron.IpcMainEvent): boolean =>
  Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
// 封装更新相关的进程通信方法
const sendUpdateMessage = (opt: { cmd: string; data: any }) => {
  mainWindow.webContents.send(opt.cmd, opt.data);
};

function checkUpdate(win: BrowserWindow) {
  autoUpdater.logger = logger;
  autoUpdater.disableWebInstaller = false;
  // 用于本地调试
  if (!app.isPackaged) {
    Object.defineProperty(app, "isPackaged", {
      get: () => true,
    });
    autoUpdater.updateConfigPath = path.join(
      app.getAppPath(),
      "./resources/app-update.yml"
    );
    // autoUpdater.forceDevUpdateConfig = true;
  }

  mainWindow = win;
  // 关闭自动更新
  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL(feedUrl);

  // 监听升级失败事件
  autoUpdater.on("error", (error) => {
    logger.info(error);
    sendUpdateMessage({
      cmd: IPC_UPDATE_ERROR,
      data: error,
    });
  });

  // 监听发现可用更新事件
  autoUpdater.on("update-available", (message) => {
    logger.info('检查到有更新');
    logger.info(message);
    sendUpdateMessage({
      cmd: IPC_UPDATE_AVAILABLE,
      data: message,
    });
  });

  // 监听没有可用更新事件
  autoUpdater.on("update-not-available", (message) => {
    sendUpdateMessage({
      cmd: IPC_UPDATE_NOT_AVAILABLE,
      data: message,
    });
  });

  // 更新下载进度事件
  autoUpdater.on("download-progress", (progress) => {
    logger.info(progress);
    // 计算下载百分比
    const downloadPercent = parseInt(`${progress.percent}`);
    sendUpdateMessage({
      cmd: IPC_UPDATE_DOWNLOAD_PROGRESS,
      data: downloadPercent,
    });
  });

  // 监听下载完成事件
  autoUpdater.on("update-downloaded", (releaseObj) => {
    logger.info('下载完毕！提示安装更新');
    sendUpdateMessage({
      cmd: IPC_UPDATE_DOWNLOADED,
      data: releaseObj,
    });
  });

  // 接收渲染进程消息，开始检查更新
  ipcMain.on(IPC_UPDATE_CHECK, (event) => {
    if (!isMainWindowSender(event)) return;
    //执行自动更新检查
    logger.info("开始检查更新");
    autoUpdater.checkForUpdates();
  });

  // 触发更新
  ipcMain.on(IPC_UPDATE_DOWNLOAD, (event) => {
    if (!isMainWindowSender(event)) return;
    autoUpdater.downloadUpdate();
  });
  // 退出并安装更新包
  ipcMain.on(IPC_UPDATE_INSTALL, (event) => {
    if (!isMainWindowSender(event)) return;
    autoUpdater.quitAndInstall();
  });
}

export default checkUpdate;
