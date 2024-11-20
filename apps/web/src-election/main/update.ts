import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import logger from "electron-log";
import path from "path";
import TSDD_FONFIG from "./confing";
const feedUrl = `${TSDD_FONFIG.updataUrl}v1/common/pcupdater/`;

let mainWindow: BrowserWindow;
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
      cmd: "update-error",
      data: error,
    });
  });

  // 监听发现可用更新事件
  autoUpdater.on("update-available", (message) => {
    logger.info('检查到有更新');
    logger.info(message);
    sendUpdateMessage({
      cmd: "update-available",
      data: message,
    });
  });

  // 监听没有可用更新事件
  autoUpdater.on("update-not-available", (message) => {
    sendUpdateMessage({
      cmd: "update-not-available",
      data: message,
    });
  });

  // 更新下载进度事件
  autoUpdater.on("download-progress", (progress) => {
    logger.info(progress);
    // 计算下载百分比
    const downloadPercent = parseInt(`${progress.percent}`);
    sendUpdateMessage({
      cmd: "download-progress",
      data: downloadPercent,
    });
  });

  // 监听下载完成事件
  autoUpdater.on("update-downloaded", (releaseObj) => {
    logger.info('下载完毕！提示安装更新');
    sendUpdateMessage({
      cmd: "update-downloaded",
      data: releaseObj,
    });
  });

  // 接收渲染进程消息，开始检查更新
  ipcMain.on("check-update", () => {
    //执行自动更新检查
    logger.info("开始检查更新");
    autoUpdater.checkForUpdates();
  });

  // 触发更新
  ipcMain.on("update-app", () => {
    autoUpdater.downloadUpdate();
  });
  // 退出并安装更新包
  ipcMain.on("install-update", () => {
    autoUpdater.quitAndInstall();
  });
}

export default checkUpdate;
