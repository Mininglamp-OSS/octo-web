import { WKApp, Menus, ProviderListener, startVersionCheck, t } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";
import { reconcileMenuState } from "./menuReconcile";

export default class MainVM extends ProviderListener {
  private _currentMenus?: Menus;
  private _settingSelected!: boolean;

  private _historyRoutePaths: string[] = [];

  private _showNewVersion!: boolean;

  private _hasNewVersion!: boolean; // 是否有新版本

  lastVersionInfo?: VersionInfo; // 最新版本信息

  private _showMeInfo: boolean; // 是否显示我的信息

  set showNewVersion(v: boolean) {
    this._showNewVersion = v;
    this.notifyListener();
  }

  get showNewVersion() {
    return this._showNewVersion;
  }

  set hasNewVersion(v: boolean) {
    this._hasNewVersion = v;
    this.notifyListener();
  }

  get hasNewVersion() {
    return this._hasNewVersion;
  }

  get showMeInfo() {
    return this._showMeInfo;
  }

  set showMeInfo(v: boolean) {
    this._showMeInfo = v;
    this.notifyListener();
  }

  showAppVersion: boolean;
  showAppUpdate: boolean;
  showAppUpdateOperation: boolean;
  appUpdateProgress: number;

  private static VERSION_READ_KEY_PREFIX = "dmwork_last_read_version_";

  private get versionReadKey(): string {
    return MainVM.VERSION_READ_KEY_PREFIX + (WKApp.loginInfo.uid || "default");
  }

  private ipcListeners: { event: string; handler: (...args: any[]) => void }[] = [];
  private stopVersionCheck?: () => void;
  // Unsubscribe for the remote-config listener that reconciles the active view when a
  // config-gated menu (e.g. docs_on) disappears from the NavRail. See reconcileActiveMenu.
  private _unsubscribeMenuReconcile?: () => void;

  didMount(): void {
    let found = false;
    if (WKApp.route.currentPath) {
      for (const menus of this.menusList) {
        if (menus.routePath === WKApp.route.currentPath) {
          this.currentMenus = menus;
          found = true;
          break;
        }
      }
    }
    // 默认选中第一个菜单（消息模块）
    if (!found && this.menusList.length > 0) {
      this.currentMenus = this.menusList[0];
    }

    // Reconcile the active view when a remote-config flag toggles a menu OFF while it is the
    // active view (e.g. ops flips docs_on=false while a user is on /docs). Without this the
    // NavRail entry disappears but `currentMenus` still points at the gone menu and
    // MainContentLeft keeps rendering its route via `historyRoutePaths` — "hide immediately"
    // would be incomplete (reviewer feedback on #536). `menusList` is read live inside
    // reconcileActiveMenu, so it reflects the post-toggle set. Only the change listener matters
    // here: a first-load turn-ON never removes the currently active menu. This benefits every
    // config-gated menu, not just docs.
    this._unsubscribeMenuReconcile = WKApp.remoteConfig.addConfigChangeListener(() => {
      if (this.reconcileActiveMenu()) {
        this.notifyListener();
      }
    });

    if ((window as any).__POWERED_ELECTRON__) {
      this.appUpdateInit();
    } else {
      // 轮询 /version.json 检测 Web 端新版本，有新版本时亮设置按钮气泡
      this.stopVersionCheck = startVersionCheck({
        onNewVersion: (force, serverVersion) => {
          if (force) {
            // circuit breaker：防止 CDN 缓存旧 HTML 导致无限刷新
            const key = 'wk_version_reload_count';
            const count = Number(sessionStorage.getItem(key) || 0);
            if (count < 3) {
              sessionStorage.setItem(key, String(count + 1));
              window.location.reload();
              return;
            }
            // breaker 触发（连刷 3 次仍是旧版），降级为气泡提示
          }
          // 先设置 lastVersionInfo，再触发 hasNewVersion setter（setter 会 notifyListener，渲染时 lastVersionInfo 已就绪）
          this.lastVersionInfo = { appVersion: serverVersion, updateDesc: '' };
          this.hasNewVersion = true;
        },
      });
    }
  }

  private addIpcListener(event: string, handler: (...args: any[]) => void) {
    (window as any).ipc.on(event, handler);
    this.ipcListeners.push({ event, handler });
  }

  appUpdateInit() {
    // 监听升级失败事件
    this.addIpcListener("update-error", (event, message) => {
    });
    // 发现可用更新事件
    this.addIpcListener("update-available", (event, message) => {
      (window as any).ipc.send("update-app");
      this.lastVersionInfo = {
        appVersion: message.version,
        updateDesc: message.releaseNotes,
      };
      this.showAppVersion = true;
      this.notifyListener();
    });
    // 没有可用更新事件
    this.addIpcListener("update-not-available", (event, message) => {
      this.showAppUpdate = false;
      this.showAppUpdateOperation = false;
      this.showAppUpdateOperation = false;
      Toast.success(t("app.main.updateAlreadyLatest"));
    });
    // 更新下载进度事件
    this.addIpcListener("download-progress", (event, message) => {
      this.showAppUpdate = true;
      this.showAppUpdateOperation = false;
      this.appUpdateProgress = message;
      this.notifyListener();
    });
    // 监听下载完成事件
    this.addIpcListener("update-downloaded", (event, message) => {
      this.lastVersionInfo = {
        appVersion: message.version,
        updateDesc: message.releaseNotes,
      };
      this.appUpdateProgress = 100;
      this.showAppUpdateOperation = false;
      this.showAppUpdateOperation = true;
      this.notifyListener();
    });
  }

  didUnMount(): void {
    // Clean up IPC listeners to prevent memory leaks
    for (const { event, handler } of this.ipcListeners) {
      (window as any).ipc?.removeListener(event, handler);
    }
    this.ipcListeners = [];
    this.stopVersionCheck?.();
    this._unsubscribeMenuReconcile?.();
  }

  /**
   * Reconcile the active menu against the live menu list. Called on remote-config changes.
   *
   * If the currently active menu is no longer present in `menusList` (a config-gated entry such
   * as docs_on was turned off), drop its cached route from `historyRoutePaths` so the view
   * actually unmounts (tearing down e.g. the docs collab WebSocket) and fall back to the first
   * available menu. If the active menu is still present, this is a no-op.
   *
   * Deliberately one-directional: turning a menu ON never yanks the user off their current view,
   * so we only handle disappearance, not appearance (no surprise auto-navigation).
   *
   * @returns true if the active menu changed (caller should re-render), false if unchanged.
   */
  reconcileActiveMenu(): boolean {
    const result = reconcileMenuState({
      menusList: this.menusList,
      currentMenu: this._currentMenus,
      historyRoutePaths: this._historyRoutePaths,
    });
    if (!result.changed) {
      return false;
    }
    this._currentMenus = result.currentMenu;
    this._historyRoutePaths = result.historyRoutePaths;
    WKApp.currentMenuId = result.currentMenu?.id;
    return true;
  }

  // 标记当前新版本已读，清除红点
  markVersionRead() {
    if (this.lastVersionInfo?.appVersion) {
      localStorage.setItem(this.versionReadKey, this.lastVersionInfo.appVersion);
      this.hasNewVersion = false;
    }
  }

  // 安装更新
  installUpdate() {
    (window as any).ipc.send("install-update");
  }

  get menusList() {
    return WKApp.menus.menusList();
  }

  get currentMenus(): Menus | undefined {
    return this._currentMenus;
  }

  get historyRoutePaths() {
    return this._historyRoutePaths;
  }
  set currentMenus(menus: Menus | undefined) {
    this._currentMenus = menus;
    if (menus) {
      if (this._historyRoutePaths.indexOf(menus.routePath) === -1) {
        this._historyRoutePaths.push(menus.routePath);
      }
    }
    this.notifyListener();
  }
  get settingSelected() {
    return this._settingSelected;
  }

  set settingSelected(settingSelected: boolean) {
    this._settingSelected = settingSelected;
    this.notifyListener();
  }
}

export class VersionInfo {
  appVersion!: string; // 版本信息
  updateDesc!: string; // 更新描述
}
