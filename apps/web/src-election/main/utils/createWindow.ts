import { BrowserWindow, screen } from "electron";
import { join } from "path";

export function createWindow() {
  const NODE_ENV = process.env.NODE_ENV;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  // 生成窗口实例
  const mainWin = new BrowserWindow({
    width, // * 指定启动app时的默认窗口尺寸
    height, // * 指定启动app时的默认窗口尺寸
    // frame: true, // * app边框(包括关闭,全屏,最小化按钮的导航栏) @false: 隐藏
    // titleBarStyle: "hidden",
    // transparent: true, // * app 背景透明
    hasShadow: false, // * app 边框阴影
    show: false, // 启动窗口时隐藏,直到渲染进程加载完成「ready-to-show 监听事件」 再显示窗口,防止加载时闪烁
    resizable: true, // 禁止手动修改窗口尺寸
    webPreferences: {
      // 加载脚本
      preload: join(__dirname, "../..", "preload/index"),
      nodeIntegration: true,
    },
  });

  // 启动窗口时隐藏,直到渲染进程加载完成「ready-to-show 监听事件」 再显示窗口,防止加载时闪烁
  mainWin.once("ready-to-show", () => {
    mainWin.show(); // 显示窗口
  });

  if (NODE_ENV === "development") mainWin.loadURL("http://localhost:3000");
  if (NODE_ENV !== "development") {
    process.env.DIST_ELECTRON = join(__dirname, '../');
    const WEB_URL = join(process.env.DIST_ELECTRON, "../../build/index.html");
    mainWin.loadFile(WEB_URL);
  }
}
