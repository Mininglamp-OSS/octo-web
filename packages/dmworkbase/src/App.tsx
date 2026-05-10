import mitt, { Emitter } from "mitt";

/** mittBus 全局事件类型表 */
export type MittEvents = {
  "friend-applys-unread-count": number;
  "space-changed": unknown;
  "task-upload-failed": { channelKey: string };
  "wk:pending-thread": {
    groupNo: string;
    thread: import("./Service/Thread").Thread | null;
  };
  "wk:close-thread-panel": undefined;
  "wk:toggle-matter-panel": { channelId: string; channelType: number };
  /** v0.7 Matter 详情面板切换（跟子区/文件预览/任务列表可并存） */
  "wk:toggle-matter-detail-panel": { channelId: string; channelType: number };
  /** 打开多选→添加到事项的弹出菜单（由 dmworktodo 模块接管渲染） */
  "wk:open-matter-link-menu": { anchor: HTMLElement; channelId: string; channelType: number };
  "wk:switch-sidebar-tab": string;
  "wk:file-preview": {
    url: string;
    name: string;
    extension: string;
    size?: number;
    /** 来源频道 ID（用于判断是否在子区面板内触发） */
    sourceChannelId?: string;
    /** 来源频道类型 */
    sourceChannelType?: number;
    /** 消息 ID（用于标记激活态） */
    messageId?: string;
    /** 消息序号（用于回复） */
    messageSeq?: number;
    /** 发送者 UID（用于回复时 @提及） */
    fromUID?: string;
    /** 消息摘要（用于回复时显示） */
    conversationDigest?: string;
  } | null;
  'wk:open-create-matter-modal': { channelId: string; channelType: number; channelName?: string; prefillTitle?: string; prefillAssigneeUids?: string[]; clearOnConfirm?: boolean };
  /** After matter created from toolbar/Alt+Enter, send editor content then clear */
  'wk:matter-created-from-input': { channelId: string; channelType: number };
  /**
   * NavRail 菜单按钮被点击 (不论是切换到该菜单还是重复点击当前菜单)。
   * 接收方可以据此刷新数据 — 同一路由长期挂载时用户重进菜单的场景下, 组件
   * 不会自动 remount, 接收方需要主动 reload。
   */
  'wk:nav-menu-activated': { menuId: string };
  "summary-space-changed": undefined;
  /**
   * 频道头像发生变化（上传/更新）时广播。订阅者（例如 WKAvatar）可依据 channelID +
   * channelType 匹配后刷新自身缓存的 avatar URL，避免整页刷新。
   */
  "channel-avatar-changed": { channelID: string; channelType: number };
};
import { EndpointCommon } from "./EndpointCommon";
import APIClient from "./Service/APIClient";
import MenusManager from "./Service/Menus";
import { EndpointManager, IModule, ModuleManager } from "./Service/Module";
import { ProviderListener } from "./Service/Provider";
import RouteManager, { ContextRouteManager } from "./Service/Route";
import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
  Message,
  MessageContentType,
} from "wukongimjssdk";
import { IConversationProvider } from "./Service/DataSource/DataProvider";
import MessageManager from "./Service/MessageManager";
import { DefaultEmojiService, EmojiService } from "./Service/EmojiService";
import SectionManager, { Row, Section } from "./Service/Section";
import { EndpointCategory, ChannelTypeCommunityTopic } from "./Service/Const";
import { parseThreadChannelId } from "./Service/Thread";
import { DataSource } from "./Service/DataSource/DataSource";
import { ConnectAddrCallback } from "wukongimjssdk";

import "animate.css";
import "./App.css";
import RouteContext from "./Service/Context";
import { ConnectStatus } from "wukongimjssdk";
import { WKBaseContext } from "./Components/WKBase";
import StorageService from "./Service/StorageService";
import { ProhibitwordsService } from "./Service/ProhibitwordsService";

export enum ThemeMode {
  light,
  dark,
}
export class WKConfig {
  appName: string = "DMWork";
  appVersion: string = "0.0.0"; // app版本
  themeColor: string = "#1C1C23"; // 主题颜色
  secondColor: string = "rgba(232, 234, 237)";
  pageSize: number = 15; // 数据页大小
  pageSizeOfMessage: number = 30; // 每次请求消息数量
  fileHelperUID: string = "fileHelper"; // 文件助手UID
  systemUID: string = "u_10000"; // 系统uid

  private _themeMode: ThemeMode = ThemeMode.light; // 主题模式

  set themeMode(v: ThemeMode) {
    this._themeMode = v;
    const body = document.body;
    if (v === ThemeMode.dark) {
      if (body.hasAttribute("theme-mode")) {
        body.removeAttribute("theme-mode");
        body.setAttribute("theme-mode", "dark");
      } else {
        body.setAttribute("theme-mode", "dark");
      }
    } else {
      body.removeAttribute("theme-mode");
    }
    StorageService.shared.setItem("theme-mode", `${v}`);
    WKApp.shared.notifyListener();
  }

  get themeMode() {
    return this._themeMode;
  }
}

// sanitizeHttpUrl + parseOidcProviders + OidcProviderConfig 抽到 ./Service/OidcConfig
// 让 dmworklogin 的 vitest 可以做安全边界测试 (App.tsx 顶层 import 链路太重)。
// 这里 import 是 WKRemoteConfig 自己用; 同名 re-export 保持外部调用面不变。
import {
  parseOidcProviders,
  type OidcProviderConfig,
} from "./Service/OidcConfig";
export {
  sanitizeHttpUrl,
  parseOidcProviders,
} from "./Service/OidcConfig";
export type { OidcProviderConfig } from "./Service/OidcConfig";

export class WKRemoteConfig {
  revokeSecond: number = 2 * 60; // 撤回时间
  threadOn: boolean = false; // 子区功能开关，默认关闭
  /**
   * OIDC provider 元数据数组, 由后端 /v1/common/appconfig 的 oidc_providers 字段下发。
   * OIDC 关闭时为空数组。前端不再硬编码具体 IdP, 部署 env 切 provider。
   * 顶层 oidc_account_url / oidc_reset_password_url 是后端兼容老前端用的,新前端只读这里。
   */
  oidcProviders: OidcProviderConfig[] = [];
  requestSuccess: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 5; // 最大重试次数
  // listeners 仅在 appconfig 首次成功时触发, 用来通知像登录页这种在首屏前就渲染、
  // 而其内容(SSO 按钮文案/可见性)依赖 appconfig 字段的组件去 re-render。
  // 不在每次失败重试上 fire, 避免重复刷新。
  private listeners: Array<() => void> = [];

  /**
   * addListener 订阅 appconfig **首次** 加载完成事件——只 fire 一次 (后续重连/手动 refetch 不再触发)。
   * 返回 unsubscribe 函数, 调用方在卸载时务必调用。
   *
   * 调用方契约: 订阅前应先检查 requestSuccess——已 true 时跳过订阅, 自行处理初始状态。
   * 这里在 requestSuccess 已为 true 时返回 noop 是防御性兜底, 不构成「at-least-once 必通知」的语义。
   *
   * 为什么不在已加载时同步调一次 cb 来给「at-least-once」: cb 通常是 forceUpdate / setState,
   * 在调用方的 componentDidMount 同步栈里触发是 React 反模式; 用 microtask 又得给 cb 加
   * unmount 防护。当前唯一调用方 (Login) 已自检 requestSuccess, 不值得为此引入复杂度。
   */
  addListener(cb: () => void): () => void {
    if (this.requestSuccess) {
      return () => {
        /* noop */
      };
    }
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private notifyListeners() {
    // 复制一份以容忍 listener 内部 unsubscribe 时的数组改动。
    const snapshot = [...this.listeners];
    // 一次性事件: 通知后立刻清空, 避免遗忘 unsubscribe 的订阅者闭包被 singleton pin 住不被 GC。
    // 后续 addListener 在 requestSuccess=true 时已经走 noop 分支, 不会再往 listeners 里塞东西。
    this.listeners = [];
    for (const cb of snapshot) {
      try {
        cb();
      } catch (e) {
        console.error("[WKRemoteConfig] listener threw", e);
      }
    }
  }

  async startRequestConfig() {
    // 吃掉 requestConfig 的 reject: 否则 await 直接抛出, 后面的 retry 分支根本到不了——
    // 网络错误下指数退避就成了死代码。requestSuccess 在出错时保持 false, retry 分支负责重排。
    try {
      await this.requestConfig();
    } catch (e) {
      console.warn("[WKRemoteConfig] requestConfig failed, will retry", e);
    }

    if (!this.requestSuccess && this.retryCount < this.maxRetries) {
      this.retryCount++;
      // 指数退避: 3s, 6s, 12s, 24s, 48s
      const delay = 3000 * Math.pow(2, this.retryCount - 1);
      setTimeout(() => {
        this.startRequestConfig();
      }, delay);
    }
  }

  requestConfig() {
    return WKApp.apiClient.get("common/appconfig").then((result) => {
      const wasSuccessful = this.requestSuccess;
      this.requestSuccess = true;
      this.revokeSecond = result["revoke_second"];
      this.threadOn = !!result["thread_on"];
      this.oidcProviders = parseOidcProviders(result["oidc_providers"]);
      // 仅首次成功通知, 后续重新拉取(重连/手动刷新)不重复打扰订阅方。
      if (!wasSuccessful) this.notifyListeners();
    });
  }
}

export type MessageDeleteListener = (
  message: Message,
  preMessage?: Message
) => void;

export class LoginInfo {
  appID!: string;
  shortNo!: string; // 短号
  token?: string;
  uid?: string;
  name: string | undefined;
  role!: string;
  isWork!: boolean;
  sex!: number;
  /**
   * 登录方式标识：'local' 表示用户名/邮箱密码登录，其他值为 OIDC 提供方 id
   * （与后端 /v1/common/appconfig.oidc_providers[].id 对齐）。
   * 用于 UI 区分入口（如 OIDC 用户跳转对应 IdP 的账户中心修改密码）。
   */
  loginProvider?: string;

  /**
   * OCTO 实名认证状态缓存（YUJ-359 / GH #1121）。
   * 数据源：profile API `/v1/user/me` 或 `/v1/users/:uid`。
   * 作为跨页面展示「✓ 已实名」和「去认证」CTA 的快速判定，
   * 完整数据仍以最新 channelInfo.orgData 为准（MeInfo 会主动 fetch 刷新）。
   */
  realnameVerified?: boolean;
  realName?: string;
  realnameVerifiedAt?: number; // Unix 秒或毫秒，后端未定义前端不展示即可

  /**
   * save 保存登录信息
   */
  public save() {
    this.setStorageItemForSID("app_id", this.appID ?? "");
    this.setStorageItemForSID("short_no", this.shortNo ?? "");
    this.setStorageItemForSID("uid", this.uid ?? "");
    this.setStorageItemForSID("token", this.token ?? "");
    this.setStorageItemForSID("name", this.name ?? "");
    this.setStorageItemForSID("role", this.role ?? "");
    this.setStorageItemForSID("is_work", this.isWork ? "1" : "0");
    this.setStorageItemForSID("sex", this.sex === 1 ? "1" : "0");
    this.setStorageItemForSID("login_provider", this.loginProvider ?? "");
    // YUJ-359: 实名认证状态 — 仅持久化 bool + string，避免把大对象写入 storage。
    this.setStorageItemForSID("realname_verified", this.realnameVerified ? "1" : "0");
    this.setStorageItemForSID("real_name", this.realName ?? "");
  }

  // 获取查询参数
  public getQueryVariable(variable: string) {
    const query = window.location.search.substring(1);
    const vars = query.split("&");
    for (let i = 0; i < vars.length; i++) {
      const pair = vars[i].split("=");
      if (pair[0] === variable) {
        return pair[1];
      }
    }
    return false;
  }

  public setStorageItemForSID(key: string, value: string) {
    let sid = this.getSID();

    this.setStorageItem(key + sid, value);
  }

  public getStorageItemForSID(key: string): string | null {
    let sid = this.getSID();
    return this.getStorageItem(key + sid);
  }

  public removeStorageItemForSID(key: string) {
    let sid = this.getSID();
    this.removeStorageItem(key + sid);
  }

  public getSID(): string {
    let sid = this.getQueryVariable("sid") || "";
    return sid;
  }

  public setStorageItem(key: string, value: string) {
    StorageService.shared.setItem(key, value);
  }
  public getStorageItem(key: string): string | null {
    return StorageService.shared.getItem(key);
  }
  public removeStorageItem(key: string) {
    StorageService.shared.removeItem(key);
  }

  /**
   * load 加载登录信息
   */
  public load() {
    this.uid = this.getStorageItemForSID("uid") || "";
    this.shortNo = this.getStorageItemForSID("short_no") || "";
    this.token = this.getStorageItemForSID("token") || "";
    this.name = this.getStorageItemForSID("name") || "";
    this.appID = this.getStorageItemForSID("app_id") || "";
    this.role = this.getStorageItemForSID("role") || "";
    const isWorkStr = this.getStorageItemForSID("is_work");
    if (isWorkStr === "1") {
      this.isWork = true;
    } else {
      this.isWork = false;
    }

    const sexStr = this.getStorageItemForSID("sex");
    if (sexStr === "1") {
      this.sex = 1;
    } else {
      this.sex = 0;
    }
    const provider = this.getStorageItemForSID("login_provider");
    this.loginProvider = provider ? provider : undefined;
    // YUJ-359: 恢复实名认证状态缓存。字段缺失时降级到「未认证」。
    this.realnameVerified = this.getStorageItemForSID("realname_verified") === "1";
    const storedRealName = this.getStorageItemForSID("real_name");
    this.realName = storedRealName ? storedRealName : undefined;
  }
  // 是否登录
  isLogined() {
    if (!this.token || this.token === "") {
      return false;
    }
    return true;
  }
  logout() {
    this.token = undefined;
    this.appID = "";
    this.role = "";
    this.loginProvider = undefined;
    this.removeStorageItemForSID("token");
    this.removeStorageItemForSID("app_id");
    this.removeStorageItemForSID("role");
    this.removeStorageItemForSID("is_work");
    // 与 StorageService CROSS_TAB_KEYS 白名单对齐，清理双写到 localStorage 的剩余 key
    this.removeStorageItemForSID("uid");
    this.removeStorageItemForSID("short_no");
    this.removeStorageItemForSID("name");
    this.removeStorageItemForSID("sex");
    this.removeStorageItemForSID("login_provider");
    // YUJ-359: 清除实名认证缓存
    this.realnameVerified = undefined;
    this.realName = undefined;
    this.realnameVerifiedAt = undefined;
    this.removeStorageItemForSID("realname_verified");
    this.removeStorageItemForSID("real_name");
  }
}

export default class WKApp extends ProviderListener {
  private constructor() {
    super();
  }
  public static shared = new WKApp();
  static route = RouteManager.shared; // 路由管理
  static routeLeft = new ContextRouteManager(); // 左边页面路由
  static routeRight = new ContextRouteManager(); // 右边（main）页面路由
  static menus = MenusManager.shared; // 菜单
  // Callback to switch the active sidebar menu by id (set by Main page)
  static switchToMenuById?: (menuId: string) => void;
  static openSummaryDetail?: (taskId: number) => void;
  static searchChatCandidates?: (params: { keyword?: string; chat_type?: string; space_id?: string }) => Promise<any[]>;
  // Id of the currently active sidebar menu (kept in sync by Main page)
  static currentMenuId?: string;
  static apiClient = APIClient.shared; // api客户端
  static config: WKConfig = new WKConfig(); // app配置
  static remoteConfig: WKRemoteConfig = new WKRemoteConfig(); // 远程配置
  static loginInfo: LoginInfo = new LoginInfo(); // 登录信息
  static endpoints: EndpointCommon = new EndpointCommon(); // 常用端点
  static conversationProvider: IConversationProvider; // 最近会话相关数据源
  static messageManager: MessageManager = new MessageManager(); // 消息管理
  static emojiService: EmojiService = DefaultEmojiService.shared; // emoji
  static sectionManager: SectionManager = new SectionManager(); // section管理
  static dataSource: DataSource = new DataSource(); // 数据源
  static endpointManager: EndpointManager = EndpointManager.shared; // 端点管理
  static mittBus: Emitter<MittEvents> = mitt<MittEvents>();
  private messageDeleteListeners: MessageDeleteListener[] =
    new Array<MessageDeleteListener>(); // 消息删除监听

  supportFavorites = [MessageContentType.text, MessageContentType.image]; // 注册收藏的消息
  supportEdit = [MessageContentType.text]; // 注册编辑的消息
  notSupportForward: number[] = []; // 不支持转发的消息

  openChannel?: Channel; // 当前打开的会话频道
  content?: JSX.Element;

  /**
   * 附件发送守卫（#143/#144）
   * Conversation 在有未发送附件时注册此回调，返回 true 表示可以切换，false 表示有附件待确认。
   * componentDidMount 注册，componentWillUnmount 清空（仅注册者可清空，防止新实例 guard 被旧实例覆盖）。
   */
  pendingAttachmentGuard?: () => boolean;
  pendingAttachmentGuardId?: symbol;

  /** 待打开子区面板的群组 ID，ChatContentPage 挂载时检查并消费 */
  pendingThreadPanel?: string;

  /** 待打开的具体子区，ChatContentPage 挂载时检查并消费 */
  pendingThread?: {
    groupNo: string;
    channelId: string;
    name: string;
    shortId: string;
  };

  /** 待打开的文件预览，切换频道后由新页面消费 */
  pendingFilePreview?: {
    url: string;
    name: string;
    extension: string;
    size?: number;
    messageId?: string;
    sourceChannelId?: string;
    sourceChannelType?: number;
    /** 消息序号（用于回复） */
    messageSeq?: number;
    /** 发送者 UID（用于回复时 @提及） */
    fromUID?: string;
    /** 消息摘要（用于回复时显示） */
    conversationDigest?: string;
  };

  baseContext!: WKBaseContext; // DMWork基础上下文

  private _notificationIsClose: boolean = false; // 通知是否关闭

  private wsaddrs = new Array<string>(); // ws的连接地址
  private addrUsed = false; // 地址是否被使用

  isPC = false; // 是否是PC端
  deviceId: string = ""; // 设备ID
  currentSpaceId: string = ""; // 当前选中的 Space ID
  channelSpaceMap: Map<string, string> = new Map(); // channelID_channelType → spaceID 缓存
  spaceChecked: boolean = false; // Space 检查是否完成
  deviceName: string = ""; // 设备名称
  deviceModel: string = ""; // 设备型号

  set notificationIsClose(v: boolean) {
    this._notificationIsClose = v;
    StorageService.shared.setItem("NotificationIsClose", v ? "1" : "");
  }

  get notificationIsClose() {
    return this._notificationIsClose;
  }

  // app启动
  startup() {
    WKApp.loginInfo.load(); // 加载登录信息

    // 是否是PC端
    if (
      (window as any)?.__POWERED_ELECTRON__ ||
      (window as any).__TAURI_IPC__
    ) {
      this.isPC = true;
    }
    this.deviceId = this.getDeviceIdFromStorage();
    this.deviceName = this.getOSAndVersion();
    this.deviceModel = this.getBrandsFromUserAgent();

    // 暗黑模式已关闭，强制亮色
    WKApp.config.themeMode = ThemeMode.light;

    WKSDK.shared().config.provider.connectAddrCallback = async (
      callback: ConnectAddrCallback
    ) => {
      if (!this.wsaddrs || this.wsaddrs.length === 0) {
        this.wsaddrs = await WKApp.dataSource.commonDataSource.imConnectAddrs();
      }
      if (this.wsaddrs.length > 0) {
        this.addrUsed = true;
        callback(this.wsaddrs[0]);
      }
    };

    WKApp.endpoints.addOnLogin(() => {
      this.startMain();
    });

    if (WKApp.loginInfo.isLogined()) {
      this.startMain();
    }

    WKSDK.shared().connectManager.addConnectStatusListener(
      (status: ConnectStatus, reasonCode?: number) => {
        if (status === ConnectStatus.ConnectKick) {
          WKApp.shared.logout();
        } else if (reasonCode === 2) {
          // 认证失败！
          WKApp.shared.logout();
        } else if (status === ConnectStatus.Disconnect) {
          if (this.addrUsed && this.wsaddrs.length > 1) {
            const oldwsAddr = this.wsaddrs[0];
            this.wsaddrs.splice(0, 1);
            this.wsaddrs.push(oldwsAddr);
            this.addrUsed = false;
          }
        }
      }
    );

    // 通知设置
    const notificationIsClose = StorageService.shared.getItem(
      "NotificationIsClose"
    );
    if (notificationIsClose === "1") {
      this._notificationIsClose = true;
    } else {
      this._notificationIsClose = false;
    }

    WKApp.remoteConfig.startRequestConfig();
  }

  getDeviceIdFromStorage() {
    let deviceId = StorageService.shared.getItem("deviceId");
    if (!deviceId || deviceId === "") {
      deviceId = this.generateUUID();
      StorageService.shared.setItem("deviceId", deviceId);
    }
    return deviceId;
  }

  generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  getOSAndVersion() {
    const userAgent: string = navigator.userAgent;
    if (/Windows NT (\d+\.\d+)/i.test(userAgent)) {
      const version =
        userAgent.match(/Windows NT (\d+\.\d+)/i)?.[1] ?? "unknown";
      return `Windows ${version}`;
    } else if (/Mac OS X (\d+_\d+(_\d+)?)/i.test(userAgent)) {
      const version =
        userAgent
          .match(/Mac OS X (\d+_\d+(_\d+)?)/i)?.[1]
          ?.replace(/_/g, ".") ?? "unknown";
      return `MacOS ${version}`;
    } else if (/Android (\d+(\.\d+)?)/i.test(userAgent)) {
      const version =
        userAgent.match(/Android (\d+(\.\d+)?)/i)?.[1] ?? "unknown";
      return `Android ${version}`;
    } else if (/CPU (iPhone )?OS (\d+_\d+(_\d+)?)/i.test(userAgent)) {
      const version =
        userAgent
          .match(/CPU (iPhone )?OS (\d+_\d+(_\d+)?)/i)?.[2]
          ?.replace(/_/g, ".") ?? "unknown";
      return `iOS ${version}`;
    } else if (/Linux/i.test(userAgent)) {
      return "Linux (version not available)";
    } else {
      return "Unknown OS and version";
    }
  }

  getBrandsFromUserAgent(): string {
    const userAgent: string = navigator.userAgent;

    if (/Chrome\/(\d+)/i.test(userAgent)) {
      const version = userAgent.match(/Chrome\/(\d+)/i)?.[1];
      return `Chrome ${version}`;
    } else if (/Firefox\/(\d+)/i.test(userAgent)) {
      const version = userAgent.match(/Firefox\/(\d+)/i)?.[1];
      return `Firefox ${version}`;
    } else if (/Safari\/(\d+)/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
      const version = userAgent.match(/Version\/(\d+)/i)?.[1];
      return `Safari ${version}`;
    } else if (/Edge\/(\d+)/i.test(userAgent)) {
      const version = userAgent.match(/Edge\/(\d+)/i)?.[1];
      return `Edge ${version}`;
    } else {
      return "Unknown browser";
    }
  }

  startMain() {
    this.connectIM();
    WKApp.dataSource.contactsSync(); // 同步通讯录
    ProhibitwordsService.shared.sync(); // 同步敏感词

    WKApp.apiClient
      .get(`/user/devices/${WKApp.shared.deviceId}`)
      .then((res) => {
        if (res.id) {
          WKSDK.shared().config.clientMsgDeviceId = res.id;
        }
      });
  }

  connectIM() {
    WKSDK.shared().config.uid = WKApp.loginInfo.uid;
    WKSDK.shared().config.token = WKApp.loginInfo.token;
    WKSDK.shared().connect();
  }

  registerModule(module: IModule) {
    ModuleManager.shared.register(module);
  }

  restContent(content: JSX.Element) {
    this.content = content;
    this.notifyListener();
  }

  // 是否登录
  isLogined() {
    return WKApp.loginInfo.isLogined();
  }
  // 登出
  logout() {
    WKApp.loginInfo.logout();
    localStorage.removeItem("currentSpaceId");
    this.currentSpaceId = "";
    this.spaceChecked = false;
    window.location.reload();
  }

  avatarChannel(channel: Channel) {
    if (!channel) {
      return "";
    }
    let avatarTag = this.getChannelAvatarTag(channel);
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (channelInfo && channelInfo.logo && channelInfo.logo !== "") {
      let logo = channelInfo.logo;
      // Data URIs are self-contained — return as-is without query params or URL rewriting
      if (logo.startsWith('data:')) {
        return logo;
      }
      if (logo.indexOf("?") !== -1) {
        logo += "&v=" + avatarTag;
      } else {
        logo += "?v=" + avatarTag;
      }
      return WKApp.dataSource.commonDataSource.getImageURL(logo);
    }
    const baseURL = WKApp.apiClient.config.apiURL;
    if (channel.channelType === ChannelTypePerson) {
      // 从 Space channel_id 中提取真实 uid
      let uid = channel.channelID;
      const spaceId = WKApp.shared.currentSpaceId;
      if (spaceId && uid.startsWith(`s${spaceId}_`)) {
        uid = uid.substring(spaceId.length + 2);
      }
      if (!uid) uid = channel.channelID; // fallback
      return `${baseURL}users/${uid}/avatar?v=${avatarTag}`;
    } else if (channel.channelType === ChannelTypeGroup) {
      return `${baseURL}groups/${channel.channelID}/avatar?v=${avatarTag}`;
    } else if (channel.channelType === ChannelTypeCommunityTopic) {
      // 子区使用父群头像
      const parsed = parseThreadChannelId(channel.channelID);
      if (parsed) {
        return `${baseURL}groups/${parsed.groupNo}/avatar?v=${avatarTag}`;
      }
    }
    return "";
  }

  avatarUser(uid: string) {
    const c = new Channel(uid, ChannelTypePerson);
    return this.avatarChannel(c);
  }

  avatarOrg(orgID: string) {
    const baseURL = WKApp.apiClient.config.apiURL;
    return `${baseURL}organizations/${orgID}/logo`;
  }

  // 我的用户头像发送改变
  myUserAvatarChange() {
    this.changeChannelAvatarTag(
      new Channel(WKApp.loginInfo.uid || "", ChannelTypePerson)
    );
  }

  changeChannelAvatarTag(channel: Channel) {
    let myAvatarTag = "channelAvatarTag";
    if (channel) {
      myAvatarTag = `channelAvatarTag:${channel.channelType}${channel.channelID}`;
    }
    const t = new Date().getTime();
    WKApp.loginInfo.setStorageItem(myAvatarTag, `${t}`);
    // 通知订阅者（例如 WKAvatar）立即刷新对应 channel 的头像，避免必须整页刷新
    if (channel) {
      WKApp.mittBus.emit("channel-avatar-changed", {
        channelID: channel.channelID,
        channelType: channel.channelType,
      });
    }
  }
  getChannelAvatarTag(channel?: Channel) {
    let myAvatarTag = "channelAvatarTag";
    if (channel) {
      myAvatarTag = `channelAvatarTag:${channel.channelType}${channel.channelID}`;
    }
    const tag = WKApp.loginInfo.getStorageItem(myAvatarTag);
    if (!tag) {
      const defaultTag = new Date().getTime().toString();
      WKApp.loginInfo.setStorageItem(myAvatarTag, defaultTag);
      return defaultTag;
    }
    return tag;
  }

  avatarGroup(groupNo: string) {
    const channel = new Channel(groupNo, ChannelTypeGroup);
    return this.avatarChannel(channel);
  }

  // 注册频道设置
  channelSettingRegister(
    sectionID: string,
    sectionFnc: (context: RouteContext<any>) => Section | undefined,
    sort?: number
  ) {
    WKApp.sectionManager.register(
      EndpointCategory.channelSetting,
      sectionID,
      sectionFnc,
      sort
    );
  }

  // 获取频道设置
  channelSettings(context: RouteContext<any>): Section[] {
    return WKApp.sectionManager.sections(
      EndpointCategory.channelSetting,
      context
    );
  }

  // 注册管理设置
  channelManageRegister(
    sectionID: string,
    sectionFnc: (context: RouteContext<any>) => Section | undefined
  ) {
    WKApp.sectionManager.register(
      EndpointCategory.channelManage,
      sectionID,
      sectionFnc
    );
  }

  // 获取频道管理
  channelManages(context: RouteContext<any>): Section[] {
    return WKApp.sectionManager.sections(
      EndpointCategory.channelManage,
      context
    );
  }

  chatMenusRegister(sid: string, f: (param: any) => ChatMenus, sort?: number) {
    WKApp.endpointManager.setMethod(
      sid,
      (param) => {
        return f(param);
      },
      {
        category: EndpointCategory.chatMenusPopover,
        sort: sort,
      }
    );
  }
  chatMenus(param?: any): ChatMenus[] {
    return WKApp.endpointManager.invokes<ChatMenus>(
      EndpointCategory.chatMenusPopover,
      param
    );
  }

  sectionAddRow(sectionID: string, row: Row, context: RouteContext<any>) {
    const section = WKApp.sectionManager.section(sectionID, context);
    if (section) {
      if (!section.rows) {
        section.rows = [];
      }
      section.rows.push(row);
    }
  }

  // 注册用户信息
  userInfoRegister(
    sectionID: string,
    sectionFnc: (context: RouteContext<any>) => Section | undefined,
    sort?: number
  ) {
    WKApp.sectionManager.register(
      EndpointCategory.userInfo,
      sectionID,
      sectionFnc
    );
  }

  // 获取用户信息
  userInfos(context: RouteContext<any>): Section[] {
    return WKApp.sectionManager.sections(EndpointCategory.userInfo, context);
  }

  private getFriendApplysKey() {
    return `${WKApp.loginInfo.uid}friendApplys`;
  }

  public getFriendApplys(): Array<FriendApply> {
    const friendApplys = new Array<FriendApply>();
    const value = WKApp.loginInfo.getStorageItem(this.getFriendApplysKey());
    if (!value || value === "") {
      return friendApplys;
    }
    let friendApplyObjs: any[] = [];
    try {
      friendApplyObjs = JSON.parse(value);
    } catch (e) {
      console.error("Failed to parse friend apply data:", e);
      return friendApplys;
    }

    if (friendApplyObjs && friendApplyObjs.length > 0) {
      for (const friendApplyObj of friendApplyObjs) {
        const f = new FriendApply();
        f.uid = friendApplyObj.uid;
        f.to_name = friendApplyObj.to_name;
        f.remark = friendApplyObj.remark;
        f.status = friendApplyObj.status;
        f.token = friendApplyObj.token;
        f.unread = friendApplyObj.unread;
        f.createdAt = friendApplyObj.createdAt;
        friendApplys.push(f);
      }
    }
    friendApplys.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });
    return friendApplys;
  }

  public setFriendApplysUnreadCount() {
    if (WKApp.loginInfo.isLogined()) {
      WKApp.apiClient.get(`/user/reddot/friendApply`).then((res) => {
        WKApp.mittBus.emit("friend-applys-unread-count", res.count);
        WKApp.loginInfo.setStorageItem(
          `${WKApp.loginInfo.uid}-friend-applys-unread-count`,
          res.count
        );
        WKApp.menus.refresh();
      });
    }
  }

  public getFriendApplysUnreadCount() {
    // const friendApplys = this.getFriendApplys();
    let unreadCount = 0;
    // if (friendApplys && friendApplys.length > 0) {
    //   for (const friendApply of friendApplys) {
    //     if (friendApply.unread) {
    //       unreadCount++;
    //     }
    //   }
    // }
    if (WKApp.loginInfo.isLogined()) {
      const num = WKApp.loginInfo.getStorageItem(
        `${WKApp.loginInfo.uid}-friend-applys-unread-count`
      );
      unreadCount = Number(num);
    }
    return unreadCount;
  }

  public async friendApplyMarkAllReaded(): Promise<void> {
    // let friendApplys = this.getFriendApplys();
    // if (!friendApplys) {
    //   friendApplys = new Array<FriendApply>();
    // }
    // var change = false;
    // for (const friendApply of friendApplys) {
    //   if (friendApply.unread) {
    //     friendApply.unread = false;
    //     change = true;
    //   }
    // }
    // if (change) {
    //   WKApp.loginInfo.setStorageItem(
    //     this.getFriendApplysKey(),
    //     JSON.stringify(friendApplys)
    //   );
    //   WKApp.endpointManager.invokes(EndpointCategory.friendApplyDataChange);
    // }
    if (WKApp.loginInfo.isLogined()) {
      WKApp.loginInfo.setStorageItem(
        `${WKApp.loginInfo.uid}-friend-applys-unread-count`,
        "0"
      );
    }
    await WKApp.apiClient.delete(`/user/reddot/friendApply`);
  }

  public addFriendApply(friendApply: FriendApply) {
    let friendApplys = this.getFriendApplys();
    if (!friendApplys) {
      friendApplys = new Array<FriendApply>();
    }

    let exist = false;
    for (let index = 0; index < friendApplys.length; index++) {
      const friendAy = friendApplys[index];
      if (friendAy.uid === friendApply.uid) {
        friendApplys[index] = friendApply;
        exist = true;
        break;
      }
    }
    if (!exist) {
      friendApplys.push(friendApply);
    }
    WKApp.loginInfo.setStorageItem(
      this.getFriendApplysKey(),
      JSON.stringify(friendApplys)
    );
    WKApp.endpointManager.invokes(EndpointCategory.friendApplyDataChange);
  }

  public updateFriendApply(friendApply: FriendApply) {
    let friendApplys = this.getFriendApplys();
    if (!friendApplys) {
      friendApplys = new Array<FriendApply>();
    }
    let exist = false;
    for (let index = 0; index < friendApplys.length; index++) {
      const friendAy = friendApplys[index];
      if (friendAy.uid === friendApply.uid) {
        friendApplys[index] = friendApply;
        exist = true;
        break;
      }
    }
    if (exist) {
      WKApp.loginInfo.setStorageItem(
        this.getFriendApplysKey(),
        JSON.stringify(friendApplys)
      );
    }
  }

  public addMessageDeleteListener(listener: MessageDeleteListener) {
    this.messageDeleteListeners.push(listener);
  }
  public removeMessageDeleteListener(listener: MessageDeleteListener) {
    const len = this.messageDeleteListeners.length;
    for (let i = 0; i < len; i++) {
      if (listener === this.messageDeleteListeners[i]) {
        this.messageDeleteListeners.splice(i, 1);
        return;
      }
    }
  }
  public notifyMessageDeleteListener(message: Message, preMessage?: Message) {
    const len = this.messageDeleteListeners.length;
    for (let i = 0; i < len; i++) {
      this.messageDeleteListeners[i](message, preMessage);
    }
  }
}

export enum FriendApplyState {
  apply,
  accepted,
}
// 好友申请
export class FriendApply {
  uid!: string;
  to_uid!: string;
  to_name!: string;
  remark?: string;
  token?: string;
  status!: FriendApplyState;
  unread: boolean = false; // 是否未读
  createdAt!: number; // 创建时间
}

export class ChatMenus {
  key?: string;
  icon!: string;
  title!: string;
  sort?: number = 0;
  onClick?: () => void;
}
