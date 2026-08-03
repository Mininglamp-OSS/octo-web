import { WKApp, Menus, ProviderListener, normalizeRoutePath, startVersionCheck, t } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";
import { reconcileMenuState, resolvePendingRouteActivation } from "./menuReconcile";

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
  // A boot route (e.g. /docs) that had no matching menu at didMount because a config-gated menu
  // (docs_on) had not resolved yet. Kept so it can be activated once the menu appears on the
  // first appconfig load, then cleared. Any explicit user navigation also clears it (see the
  // currentMenus setter) so a late toggle never yanks the user off a view they chose.
  private _pendingRouteActivation?: string;
  private _onBrowserRouteChange = () => {
    this.syncMenuFromBrowserPath();
  };

  private findMenuForRoute(routePath: string): Menus | undefined {
    return this.menusList
      .filter((menus) => {
        if (menus.routePath === routePath) return true;
        if (menus.routePath === "/") return false;
        return routePath.startsWith(`${menus.routePath}/`);
      })
      .sort((a, b) => b.routePath.length - a.routePath.length)[0];
  }

  didMount(): void {
    let found = false;
    const bootPath = normalizeRoutePath(window.location.pathname || WKApp.route.currentPath);
    if (bootPath) {
      const menus = this.findMenuForRoute(bootPath);
      if (menus) {
        this.currentMenus = menus;
        found = true;
      }
    }
    // 默认选中第一个菜单（消息模块）
    if (!found && this.menusList.length > 0) {
      this.currentMenus = this.menusList[0];
    }
    // Deep-link deferral (#536 reviewer follow-up): we fell back to chat because the URL's route
    // matched no live menu. When that route belongs to a config-gated menu still resolving (e.g.
    // /docs before docs_on arrives), remember it so activatePendingRouteMenu can select it once
    // the menu appears — otherwise a hard load / refresh / bookmark of /docs stays stuck on chat
    // in the enabled deployment. Set AFTER the fallback assignment above, whose setter clears it.
    if (!found && !!bootPath && bootPath !== "/") {
      this._pendingRouteActivation = bootPath;
    }

    // React to remote-config changes (e.g. ops flips docs_on) in two directions:
    //  - disappearance: a menu that was the active view is gated OFF → reconcileActiveMenu drops
    //    its route + falls back (also tears down its shared-pane view, see reconcileActiveMenu);
    //  - appearance: a gated menu we deep-linked to at boot turns ON → activatePendingRouteMenu
    //    selects the route the URL originally asked for.
    // `menusList` is read live inside both, so it reflects the post-change gated set. This
    // benefits every config-gated menu, not just docs.
    this._unsubscribeMenuReconcile = WKApp.remoteConfig.addConfigChangeListener(() => {
      const reconciled = this.reconcileActiveMenu();
      const activated = this.activatePendingRouteMenu();
      if (reconciled || activated) {
        this.notifyListener();
      }
    });
    window.addEventListener("popstate", this._onBrowserRouteChange);

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
    window.removeEventListener("popstate", this._onBrowserRouteChange);
  }

  private syncMenuFromBrowserPath(): boolean {
    const routePath = normalizeRoutePath(window.location.pathname);
    const target = this.findMenuForRoute(routePath);
    if (!target) {
      if (routePath !== "/") {
        this._pendingRouteActivation = routePath;
      }
      return false;
    }
    if (this._currentMenus?.id === target.id) {
      return false;
    }
    this._currentMenus = target;
    if (this._historyRoutePaths.indexOf(target.routePath) === -1) {
      this._historyRoutePaths.push(target.routePath);
    }
    WKApp.currentMenuId = target.id;
    this._pendingRouteActivation = undefined;
    this.notifyListener();
    WKApp.mittBus.emit("wk:nav-menu-activated", { menuId: target.id });
    return true;
  }

  /**
   * Reconcile menu state against the live menu list. Called on remote-config changes.
   *
   * Drops any `historyRoutePaths` entry whose menu is no longer present (a config-gated entry
   * such as docs_on was turned off) — including background tabs the user isn't currently on, not
   * just the active one — so the corresponding view unmounts. If the *active* menu itself
   * vanished, additionally falls back to the first available menu.
   *
   * The *active* menu may have pushed content into the shared right-hand pane
   * (`WKApp.routeRight`, e.g. the docs collab editor via `routeRight.replaceToRoot`), which is
   * independent of `historyRoutePaths` and would otherwise keep its WebSocket connected after its
   * NavRail entry disappears. When the active menu itself vanishes we clear that pane too,
   * mirroring what a manual menu switch already does for a non-chat menu (see `onMenuClick` in
   * `Pages/Main/index.tsx`). This must NOT fire just because some hidden/background tab was
   * pruned — `routeRight` is shared with whatever menu is *currently* active (e.g. chat pushes
   * its own content there too via EndpointCommon.tsx), so clearing it on every prune would wipe
   * an unrelated active view (an open chat conversation) whenever some other gated-off
   * background tab happens to be dropped from history at the same time.
   *
   * Deliberately one-directional: turning a menu ON never yanks the user off their current view,
   * so we only handle disappearance, not appearance (no surprise auto-navigation).
   *
   * @returns true if the active menu or history changed (caller should re-render), false if
   * unchanged.
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
    if (result.activeMenuVanished) {
      WKApp.routeRight.popToRoot();
    }
    return true;
  }

  /**
   * Activate a route the user deep-linked to at boot but which had no live menu then because a
   * config-gated menu (e.g. docs_on) was still resolving. Called on remote-config changes.
   *
   * If `_pendingRouteActivation` is set and a menu with that routePath is now present, select it
   * (adding its route to `historyRoutePaths` so MainContentLeft renders it) and clear the pending
   * path. If the menu is still absent, keep waiting; if it has appeared but is already active,
   * just clear the pending path. Only ever activates the *exact* route the URL asked for — never
   * a surprise jump — and the pending path is dropped the moment the user navigates themselves
   * (see the currentMenus setter), so a late toggle can't move a user off a view they chose.
   *
   * @returns true if a menu was activated (caller should re-render), false otherwise.
   */
  activatePendingRouteMenu(): boolean {
    const result = resolvePendingRouteActivation({
      pendingRoutePath: this._pendingRouteActivation,
      menusList: this.menusList,
      currentMenu: this._currentMenus,
      historyRoutePaths: this._historyRoutePaths,
    });
    this._pendingRouteActivation = result.pendingRoutePath;
    if (!result.activated) {
      return false;
    }
    this._currentMenus = result.currentMenu;
    this._historyRoutePaths = result.historyRoutePaths;
    WKApp.currentMenuId = result.currentMenu?.id;
    // NB: unlike onMenuClick we deliberately do NOT WKApp.routeRight.popToRoot() here. The route
    // being activated (e.g. /docs) mounts fresh and populates the right pane itself via
    // replaceToRoot on mount; popping first would empty the shared queue and briefly flash the
    // host's base chat placeholder (the exact race DocsHome is built to avoid). Atomic replace by
    // the newly-mounted route is cleaner than empty-then-fill.
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
    // Mirror the active id onto the app-global slot. onMenuClick / switchToMenuById /
    // syncMenuFromBrowserPath already set it explicitly, but didMount (cold-load / refresh /
    // bookmark open) goes through this setter without any such explicit write — leaving the
    // global stuck at undefined during boot. MarketSidebar reads WKApp.currentMenuId in its own
    // componentDidMount to decide whether to mount the right-pane page (see MarketSidebar.tsx:66),
    // so a missing id here is exactly why refreshing /mcp-market/mcp lands on an empty right pane.
    WKApp.currentMenuId = menus?.id;
    // An explicit menu selection (user click via onMenuClick, or switchToMenuById) cancels any
    // pending boot-route activation: the user has chosen a view, so a config-gated menu that
    // resolves later must not yank them off it. didMount sets _pendingRouteActivation only AFTER
    // its own fallback assignment runs through here, so this does not clobber that.
    this._pendingRouteActivation = undefined;
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
