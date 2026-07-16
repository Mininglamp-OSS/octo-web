import {
  app,
  BrowserWindow,
  screen,
  globalShortcut,
  ipcMain,
  nativeImage as NativeImage,
  systemPreferences,
  Menu,
  Tray,
  nativeImage,
} from "electron";
import fs from "fs";
import tmp from 'tmp';
import Screenshots from "electron-screenshots";
import { join } from "path";

import logo, { getNoMessageTrayIcon } from "./logo";
import DMWORK_CONFIG from "./config";
import checkUpdate from './update';
import { electronNotificationManager } from './notification';
import { getRandomSid } from "./utils/search";

let forceQuit = false;
let mainWindow: any;
let isMainWindowFocusedWhenStartScreenshot = false;
let screenshots: any;
let tray: any;
let trayIcon: any;
let settings: any = {};
let screenShotWindowId = 0;
let isFullScreen = false;

let isOsx = process.platform === "darwin";
let isWin = !isOsx;

const isDevelopment = process.env.NODE_ENV !== "production";
const APP_EXIT_DELAY_MS = 1000;
const TRAY_FLASH_INTERVAL_MS = 1000;


let mainMenu: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
  {
    label: "DMWork",
    submenu: [
      {
        label: `关于DMWork`,
      },
      { label: "服务", role: "services" },
      { type: "separator" },
      {
        label: "退出",
        accelerator: "Command+Q",
        click() {
          forceQuit = true;
          mainWindow = null;
          setTimeout(() => {
            app.exit(0);
          }, APP_EXIT_DELAY_MS);
        },
      },
    ],
  },
  {
    label: "编辑",
    submenu: [
      {
        role: "undo",
        label: "撤销",
      },
      {
        role: "redo",
        label: "重做",
      },
      {
        type: "separator",
      },
      {
        role: "cut",
        label: "剪切",
      },
      {
        role: "copy",
        label: "复制",
      },
      {
        role: "paste",
        label: "粘贴",
      },
      {
        role: "pasteAndMatchStyle",
        label: "粘贴并匹配样式",
      },
      {
        role: "delete",
        label: "删除",
      },
      {
        role: "selectAll",
        label: "全选",
      },
    ],
  },
  {
    label: "显示",
    submenu: [
      {
        label: isFullScreen ? "全屏" : "退出全屏",
        accelerator: "Shift+Cmd+F",
        click() {
          isFullScreen = !isFullScreen;

          mainWindow.show();
          mainWindow.setFullScreen(isFullScreen);
        },
      },
      {
        label: "切换会话",
        accelerator: "Shift+Cmd+M",
        click() {
          mainWindow.show();
          mainWindow.webContents.send("show-conversations");
        },
      },
      {
        type: "separator",
      },
      {
        type: "separator",
      },
      ...(isDevelopment
        ? [
            {
              role: "toggleDevTools" as const,
              label: "切换开发者工具",
            },
          ]
        : []),
      {
        role: "togglefullscreen",
        label: "切换全屏",
      },
    ],
  },
  {
    label: "窗口",
    role: "window",
    submenu: [
      {
        label: "新建窗口",
        accelerator: "Command+N",
        click() {
          createNewWindow();
        },
      },
      {
        label: "最小化",
        role: "minimize",
      },
      {
        label: "关闭窗口",
        role: "close",
      },
    ],
  },
  {
    label: "帮助",
    role: "help",
    submenu: [
      {
        type: "separator",
      },
      {
        role: "reload",
        label: "刷新",
      },
      {
        role: "forceReload",
        label: "强制刷新",
      },
    ],
  },
];

let trayMenu: Electron.MenuItemConstructorOptions[] = [
  {
    label: "显示窗口",
    click() {
      let isVisible = mainWindow.isVisible();
      isVisible ? mainWindow.hide() : mainWindow.show();
    },
  },
  {
    type: "separator",
  },
  {
    label: "退出",
    accelerator: "Command+Q",
    click() {
      forceQuit = true;
      mainWindow = null;
      setTimeout(() => {
        app.exit(0);
      }, APP_EXIT_DELAY_MS);
    },
  },
];


/**
 * 设置主窗口任务栏闪烁、系统托盘图闪烁及Mac端消息未读消息
 * @param unread Mac端消息未读消息
 * @param isFlash 是否闪烁 true为闪烁，false为取消
 * @returns
 */
let flashTimer: any = null;
function updateTray(unread = 0, isFlash= false): any {
  settings.showOnTray = true;

  // linux 系统不支持 tray
  if (process.platform === "linux") {
    return;
  }

  if (settings.showOnTray) {
    let contextmenu = Menu.buildFromTemplate(trayMenu);

    if (!trayIcon) {
      trayIcon = getNoMessageTrayIcon();
    }

    setTimeout(() => {
      if (!tray) {
        // Init tray icon
        tray = new Tray(trayIcon);
        if (process.platform === "linux") {
          tray.setContextMenu(contextmenu);
        }

        tray.on("right-click", () => {
          tray.popUpContextMenu(contextmenu);
        });

        tray.on("click", () => {
          mainWindow.show();
        });
      }

      if (isOsx) {
        tray.setTitle(unread > 0 ? " " + unread : "");
      }

      mainWindow.flashFrame(isFlash);
      //设置系统托盘闪烁
      if(isFlash){
        clearInterval(flashTimer)
		    let flag = false
        // 优化: 减少闪烁频率从500ms到1000ms，减少50%的CPU使用
        flashTimer = setInterval(() => {
          flag = !flag
          if(flag){
            tray.setImage(NativeImage.createEmpty());
          }else{
            tray.setImage(trayIcon);
          }
      }, TRAY_FLASH_INTERVAL_MS);
      }else{
        tray.setImage(trayIcon);
        clearInterval(flashTimer);
      }
    });
  } else {
    if (!tray) return;
    tray.destroy();
    tray = null;
  }
}

function createMenu() {
  const menu = Menu.buildFromTemplate(mainMenu);

  if (isOsx) {
    // macOS: Set application menu (appears in menu bar)
    Menu.setApplicationMenu(menu);
  } else {
    // Windows/Linux: Set window menu (appears in window title bar)
    Menu.setApplicationMenu(menu);
    // Also set it on the main window for Windows
    if (mainWindow) {
      mainWindow.setMenu(menu);
    }
  }
}

function regShortcut() {
  globalShortcut.register("CommandOrControl+shift+a", () => {
    isMainWindowFocusedWhenStartScreenshot = mainWindow.isFocused();
    console.log(
      "isMainWindowFocusedWhenStartScreenshot",
      mainWindow.isFocused()
    );
    screenshots.startCapture();
  });


  // 打开所有窗口控制台 (开发环境)
  if (isDevelopment) {
    globalShortcut.register("ctrl+shift+i", () => {
      let windows = BrowserWindow.getAllWindows();
      windows.forEach((win: any) => win.openDevTools());
    });
  }
}

// 创建新窗口的通用配置
const getWindowConfig = () => {
  return {
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // frame: true, // * app边框(包括关闭,全屏,最小化按钮的导航栏) @false: 隐藏
    // titleBarStyle: "hidden",
    // transparent: true, // * app 背景透明
    hasShadow: false, // * app 边框阴影
    show: false, // 启动窗口时隐藏,直到渲染进程加载完成「ready-to-show 监听事件」 再显示窗口,防止加载时闪烁
    resizable: true, // 禁止手动修改窗口尺寸
    // Windows: 允许用户按 Alt 键显示/隐藏菜单栏
    autoHideMenuBar: isWin,
    webPreferences: {
      // 加载脚本
      preload: join(__dirname, "..", "preload", "index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDevelopment,
    },
    // frame: !isWin,
  };
};

// 创建新窗口
const createNewWindow = () => {
  const NODE_ENV = process.env.NODE_ENV;
  const newWindow = new BrowserWindow(getWindowConfig());

  newWindow.center();
  newWindow.once("ready-to-show", () => {
    newWindow.show(); // 显示窗口
    newWindow.focus();
  });

  newWindow.on("close", (e: any) => {
    // 新窗口关闭时直接销毁，不隐藏到托盘
    newWindow.destroy();
  });

  // 加载相同的页面
  if (NODE_ENV == "development") {
    newWindow.loadURL("http://localhost:3000?sid=" + getRandomSid());
  } else {
    process.env.DIST_ELECTRON = join(__dirname, "../");
    const WEB_URL = join(process.env.DIST_ELECTRON, "../build/index.html");
    newWindow.loadFile(WEB_URL, { query: { sid: getRandomSid() } });
  }

  // 为新窗口设置菜单（Windows 需要）
  if (!isOsx) {
    const menu = Menu.buildFromTemplate(mainMenu);
    newWindow.setMenu(menu);
  }

  return newWindow;
};

const createMainWindow = async () => {
  const NODE_ENV = process.env.NODE_ENV;
  mainWindow = new BrowserWindow(getWindowConfig());
  mainWindow.center();
  mainWindow.once("ready-to-show", () => {
    mainWindow.show(); // 显示窗口
    mainWindow.focus();
  });

  mainWindow.on("close", (e: any) => {
    if (forceQuit || !tray) {
      mainWindow = null;
    } else {
      e.preventDefault();
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
        mainWindow.once("leave-full-screen", () => mainWindow.hide());
      } else {
        mainWindow.hide();
      }
    }
  });
  if (NODE_ENV === "development") mainWindow.loadURL("http://localhost:3000");
  if (NODE_ENV !== "development") {
    process.env.DIST_ELECTRON = join(__dirname, "../");
    const WEB_URL = join(process.env.DIST_ELECTRON, "../build/index.html");
    mainWindow.loadFile(WEB_URL, { query: { sid: getRandomSid() } });
  }

  ipcMain.on("screenshots-start", (event, args) => {
    console.log("main voip-message event", args);
    screenShotWindowId = event.sender.id;
    screenshots.startCapture();
  });

  ipcMain.on("get-media-access-status", async (event, mediaType: 'camera' | 'microphone')=>{
    console.log(mediaType)
    //检测麦克风权限是否开启
    const getMediaAccessStatus = systemPreferences.getMediaAccessStatus(mediaType);
    if(getMediaAccessStatus !== 'granted'){
      //请求麦克风权限
      if (mediaType === 'camera' ||  mediaType === 'microphone') {
        await systemPreferences.askForMediaAccess(mediaType);
        return systemPreferences.getMediaAccessStatus(mediaType);
      }
    }
    return getMediaAccessStatus;
  })
  // 会话未读消息消息数量托盘提醒
  ipcMain.on("conversation-anager-unread-count", (event, num) => {
    // const isFlag = num > 0 && isWin ? true : false;
    updateTray(num, false); // 不需要闪烁，闪烁很消耗性能
  });

  ipcMain.on("restart-app",()=>{
    restartApp()
  })

  // Test notification handler for debugging
  ipcMain.handle("test-notification-icon", () => {
    console.log("Testing notification icon from renderer process");
    electronNotificationManager.testIconLoading();

    // Show a test notification
    electronNotificationManager.showNotification({
      title: "Icon Test",
      body: "Testing notification icon display",
      tag: "icon-test",
      urgency: 'normal',
      timeoutType: 'default',
    });

    return true;
  });

  createMenu();

  // Set up notification manager with main window
  electronNotificationManager.setMainWindow(mainWindow);

  // Test icon loading (can be removed in production)
  if (process.env.NODE_ENV === "development") {
    electronNotificationManager.testIconLoading();
  }

  // 检查更新
  checkUpdate(mainWindow)
};

// 重启应用
function restartApp() {
  app.relaunch();
  app.exit(0);
}

const ALLOWED_DEEP_LINK_SCHEMES = ["dmwork:"];

function isValidDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_DEEP_LINK_SCHEMES.includes(parsed.protocol)) {
      return false;
    }
    const dangerousPatterns = /javascript:|data:|vbscript:|file:/i;
    if (dangerousPatterns.test(url)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function onDeepLink(url: string) {
  if (!isValidDeepLink(url)) {
    console.warn("Rejected invalid deep link:", url);
    return;
  }
  console.log("onOpenDeepLink", url);
  mainWindow.webContents.send("deep-link", url);
}

app.setName(DMWORK_CONFIG.name);
// isDevelopment && app.dock && app.dock.setIcon(logo);
app.on("open-url", (event, url) => {
  onDeepLink(url);
});

// 单例模式启动
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.on("ready", () => {
  regShortcut();
  createMainWindow(); // 创建窗口

  if (isWin) {
    app.setAppUserModelId("DMWork");
  }

  screenshots = new Screenshots({
    singleWindow: true,
  });

  const onScreenShotEnd = (result?: any) => {
    console.log(
      "onScreenShotEnd",
      isMainWindowFocusedWhenStartScreenshot,
      screenShotWindowId
    );
    if (isMainWindowFocusedWhenStartScreenshot) {
      if (result) {
        mainWindow.webContents.send("screenshots-ok", result);
      }
      mainWindow.show();
      isMainWindowFocusedWhenStartScreenshot = false;
    } else if (screenShotWindowId) {
      let windows = BrowserWindow.getAllWindows();
      let tms = windows.filter(
        (win) => win.webContents.id === screenShotWindowId
      );
      if (tms.length > 0) {
        if (result) {
          tms[0].webContents.send("screenshots-ok", result);
        }
        tms[0].show();
      }
      screenShotWindowId = 0;
    }
  };
  // 截图esc快捷键
  screenshots.on('windowCreated', ($win: any) => {
    $win.on('focus', () => {
      globalShortcut.register('esc', () => {
        if ($win?.isFocused()) {
          screenshots.endCapture();
        }
      });
    });

    $win.on('blur', () => {
      globalShortcut.unregister('esc');
    });
  });

  // 点击确定按钮回调事件
  screenshots.on("ok", (e: any, buffer: any, bounds: any) => {
    let filename = tmp.tmpNameSync() + '.png';
    let image = NativeImage.createFromBuffer(buffer);
    fs.writeFileSync(filename, image.toPNG());

    console.log("screenshots ok", e);
    onScreenShotEnd({ filePath: filename });
  });

  // 点击取消按钮回调事件
  screenshots.on("cancel", (e: any) => {
    // 执行了preventDefault
    // 点击取消不会关闭截图窗口
    // e.preventDefault()
    // console.log('capture', 'cancel2')
    console.log("screenshots cancel", e);
    onScreenShotEnd();
  });
  // 点击保存按钮回调事件
  screenshots.on("save", (e: any, { viewer }: any) => {
    console.log("screenshots save", e);
    onScreenShotEnd();
  });

  try {
    updateTray();
  } catch (e) {
    // do nothing
    console.log("==updateTray==", e);
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    return createMainWindow();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  forceQuit = true;

  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }

  if (!tray) return;

  tray.destroy();
  tray = null;
  globalShortcut.unregisterAll();
});

// 除了 macOS 外，当所有窗口都被关闭的时候退出程序。 macOS窗口全部关闭时,dock中程序不会退出
app.on("window-all-closed", () => {
  process.platform !== "darwin" && app.quit();
});
