import { WKApp, Menus, ProviderListener } from "@tsdaodao/base";
import { Toast } from "@douyinfe/semi-ui";

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

  didMount(): void {
    if (WKApp.route.currentPath) {
      for (const menus of this.menusList) {
        if (menus.routePath === WKApp.route.currentPath) {
          this.currentMenus = menus;
          break;
        }
      }
    }

    if ((window as any).__POWERED_ELECTRON__) {
      this.appUpdateInit();
    } else {
      this.requestVersionCheck().then((data) => {
        const version = data.app_version;
        if (!version) {
          this.hasNewVersion = false;
        } else {
          this.lastVersionInfo = {
            appVersion: version,
            updateDesc: data.update_desc,
          };
          if (version !== WKApp.config.appVersion) {
            this.hasNewVersion = true;
          } else {
            this.hasNewVersion = false;
          }
        }
        this.notifyListener();
      });
    }
  }

  appUpdateInit() {
    // 监听升级失败事件
    (window as any).ipc.on("update-error", (event, message) => {
      console.log("[update-error]", message);
    });
    // 发现可用更新事件
    (window as any).ipc.on("update-available", (event, message) => {
      console.log("[update-available]", message);
      (window as any).ipc.send("update-app");
      this.lastVersionInfo = {
        appVersion: message.version,
        updateDesc: message.releaseNotes,
      };
      this.showAppVersion = true;
      this.notifyListener();
    });
    // 没有可用更新事件
    (window as any).ipc.on("update-not-available", (event, message) => {
      console.log("[update-not-available]", message);
      this.showAppUpdate = false;
      this.showAppUpdateOperation = false;
      this.showAppUpdateOperation = false;
      Toast.success("已经是最新版本");
    });
    // 更新下载进度事件
    (window as any).ipc.on("download-progress", (event, message) => {
      console.log("[download-progress]", message);
      this.showAppUpdate = true;
      this.showAppUpdateOperation = false;
      this.appUpdateProgress = message;
      this.notifyListener();
    });
    // 监听下载完成事件
    (window as any).ipc.on("update-downloaded", (event, message) => {
      console.log("[update-downloaded]", message);
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
  // 安装更新
  installUpdate() {
    (window as any).ipc.send("install-update");
  }

  //检测最新版本
  requestVersionCheck() {
    return WKApp.apiClient.get(
      `common/appversion/web/${WKApp.config.appVersion}`
    );
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
