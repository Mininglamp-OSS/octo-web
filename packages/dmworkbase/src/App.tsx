import mitt, { Emitter } from "mitt";

/** mittBus 全局事件类型表 */
export type MittEvents = {
  "friend-applys-unread-count": number;
  "space-changed": unknown;
  "task-upload-failed": { channelKey: string };
  /** 内置表情清单(GET /v1/common/emojis)异步到达并发生变化:已渲染消息与表情选择器据此重渲染一次 */
  "emoji-manifest-updated": undefined;
  /** 收藏他人贴纸成功后广播,已加载过「我的贴纸」的 EmojiPanel 据此重拉列表 */
  "stickers-updated": undefined;
  /** App 回前台(visibilitychange/focus):打开中的会话据此重同步成员列表,
   * 修复合盖/息屏久后 WS 断连期间成员变更 CMD 丢失导致 @ 搜不到新成员(octo-web#567) */
  "wk:app-foreground": undefined;
  "wk:pending-thread": {
    groupNo: string;
    thread: import("./Service/Thread").Thread | null;
  };
  "wk:thread-created": {
    groupNo: string;
    threadChannelId: string;
    shortId?: string;
    thread?: import("./Service/Thread").Thread;
  };
  "wk:thread-deleted": {
    groupNo: string;
    threadChannelId: string;
    shortId?: string;
  };
  "wk:close-thread-panel": undefined;
  "wk:toggle-matter-panel": { channelId: string; channelType: number };
  /** v0.7 Matter 详情面板切换（跟子区/文件预览/任务列表可并存） */
  "wk:toggle-matter-detail-panel": { channelId: string; channelType: number };
  "wk:toggle-summary-panel": { channelId: string; channelType: number; summaryPanelView: 'history' | 'new'; forceOpen?: boolean };
  "wk:open-summary-modal": { channelId: string; channelType: number };
  /** 打开多选→添加到事项的弹出菜单（由 dmworktodo 模块接管渲染） */
  "wk:open-matter-link-menu": { anchor: HTMLElement; channelId: string; channelType: number; messages?: Array<{ messageSeq?: number; messageID?: string; fromUID?: string; fromUName?: string; content?: string; timestamp?: number; attachments?: any[] }> };
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
    /**
     * 来源事项 ID。从事项详情面板 (产出文件 tab / 时间线附件) 触发预览时传入。
     * Chat 页面据此把事项面板暂时隐藏 (而不是卸掉), 关闭预览后 unhide 让用户
     * 回到原样, 且不在文件预览头部显示 ← 返回箭头 (因为 X 已经能"回到事项")。
     */
    originMatterId?: string;
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
  /**
   * 打开「密钥 / Secrets」管理面板（YUJ-3539）。由聊天反向跳转（bot 消息里的
   * 「去添加密钥」按钮）或输入框防手滑提示触发；payload 可携带预填名字 / 明文，
   * 接收方 NavSecretsSettingsItem 据此打开面板并预填新增弹窗（绝不自动发送/保存）。
   */
  'wk:open-secrets': {
    create?: boolean;
    name?: string;
    value?: string;
  } | undefined;
  /**
   * Matter 任一字段被编辑后广播 (标题 / 主要目标 / DDL / 状态 / 负责人 /
   * 关联群聊等)。接收方 (通常是左侧事项列表) 据此 reload, 避免跨 React
   * 子树数据不同步 — 详情面板和列表分别挂在 routeRight / routeLeft, 不共
   * 享 state, 列表接口返回的字段也不会被详情页的 setMatter 影响。
   */
  'wk:matter-updated': { matterId: string };
  /** Matter 被删除后广播, 接收方据此从列表移除 */
  'wk:matter-deleted': { matterId: string };
  "summary-space-changed": undefined;
  /**
   * Chat VM 完成 requestConversationList()（切 Space / 重连后会触发）后广播。
   * 用于让那些一次性读取 WKSDK.conversationManager.conversations 缓存的消费者
   * （如合并转发选择器）在缓存被回填后再 load 一次,避免读到清空中间态。
   */
  "conversation-list-refreshed": undefined;
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
import { GroupStatusDisband } from "./Utils/groupDisband";

// 解散群的默认灰色头像（内联 SVG data-URI，避免新增二进制资源）。
const DISBANDED_GROUP_AVATAR =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" fill="#E5E6EB"/>' +
      '<g fill="#A9AEB8">' +
      '<circle cx="40" cy="33" r="14"/>' +
      '<path d="M16 66c0-13 11-21 24-21s24 8 24 21z"/>' +
      "</g></svg>"
  );
import { WKBaseContext } from "./Components/WKBase";
import StorageService from "./Service/StorageService";
import { ProhibitwordsService } from "./Service/ProhibitwordsService";
import { TypingManager } from "./Service/TypingManager";
import {
  clearAuthStorage,
  consumeOidcPostLogoutCleanup,
  isOidcLoginProvider,
  markOidcPostLogoutCleanup,
  overridePostLogoutRedirectUri,
  requestOidcLogout,
  safeEndSessionUrl,
} from "./Service/oidcLogout";

export enum ThemeMode {
  light,
  dark,
}
export class WKConfig {
  appName: string = "DMWork";
  appVersion: string = "0.0.0"; // app版本
  locale: string = "zh-CN"; // 当前语言
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
import { parseRemoteBool } from "./Utils/remoteConfig";
export {
  sanitizeHttpUrl,
  parseOidcProviders,
} from "./Service/OidcConfig";
export type { OidcProviderConfig } from "./Service/OidcConfig";

// StickerUploadLimits 解析同理抽到 ./Service/StickerUploadConfig：独立 leaf 文件,
// 不拖 App.tsx 的重依赖链路, EmojiToolbar 的 vitest 可以直接测 parse 的边界情况。
import {
  DEFAULT_STICKER_UPLOAD_LIMITS,
  parseStickerUploadLimits,
  stickerUploadLimitsEqual,
  type StickerUploadLimits,
} from "./Service/StickerUploadConfig";
export {
  DEFAULT_STICKER_UPLOAD_LIMITS,
  parseStickerUploadLimits,
  stickerUploadLimitsEqual,
} from "./Service/StickerUploadConfig";
export type { StickerUploadLimits } from "./Service/StickerUploadConfig";

export class WKRemoteConfig {
  revokeSecond: number = 2 * 60; // 撤回时间
  threadOn: boolean = false; // 子区功能开关，默认关闭
  messagesSearchOn: boolean = false; // 会话内聊天记录搜索开关，默认关闭
  disableUserCreateSpace: boolean = false; // 是否关闭普通用户创建 Space 入口
  /**
   * 是否关闭 Web 登录页的前端临时迁移提示。
   *
   * 后端字段 suppress_login_migration_notice 为 true 时表示后端/其他端已接管提示，
   * Web 端不再展示这套 Aegis 迁移说明。字段缺失或 false 时默认展示，是本轮
   * Octo -> Aegis 迁移期的产品决策。
   */
  suppressLoginMigrationNotice: boolean = false;
  /**
   * 自定义贴纸管理入口开关。后端字段 sticker_custom_enabled 为 true 时，前端展示
   * 「我的贴纸」tab 及上传/删除入口；false 或字段缺失时隐藏。
   *
   * 纯 UI 展示开关，不承担鉴权语义: /v1/sticker/user 相关接口的权限/限流/所有权
   * 校验仍由后端负责，前端不能据此推断用户是否具备上传能力。
   */
  stickerCustomEnabled: boolean = false;
  /**
   * 自定义贴纸上传的操作端可调上限（最大体积 KB / 最长边 px / 允许的扩展名），后端
   * 字段 sticker_upload_limits，与 SystemSettings.StickerUpload{MaxSizeKB,
   * MaxDimension,AllowedFormats} 同源（octo-server #544/#547）。
   *
   * 纯客户端预校验用：EmojiPanel 在用户选完文件后据此本地立即校验，避免大图/非法
   * 格式先跑完一次 HTTP 上传才被服务端拒绝。服务端 modules/file 侧仍对每次 sticker
   * upload 请求做同一份 stickerLimits 快照兜底，这份缓存过期或被绕过都不影响安全
   * 边界，前端不能据此推断上传一定会成功。
   *
   * 默认值 = 字段缺失/appconfig 请求失败时的回退值，与 PR #544 之前的历史硬编码
   * （1024 KB / 512 px / gif,png,jpg,jpeg,webp）严格等价，行为无回归。
   */
  stickerUploadLimits: StickerUploadLimits = { ...DEFAULT_STICKER_UPLOAD_LIMITS };
  /**
   * Docs 协作文档模块展示开关。后端字段 docs_on 为 true 时，前端在侧边栏 NavRail
   * 展示 Docs 入口；false 或字段缺失时隐藏。
   *
   * 默认 false(fail-safe): docs-backend 是独立服务，其反向代理路由、Hocuspocus
   * WS(:1234) 暴露、MySQL/Redis/对象存储依赖未就绪前保持隐藏，避免用户点进去卡在
   * "Loading document…" 或报错。运维在 docs-backend 部署就绪后再下发 docs_on=true。
   *
   * 纯 UI 展示开关，不承担鉴权语义: /api/v1/docs 相关接口的权限校验仍由 docs-backend
   * 负责，前端不能据此推断用户是否具备文档访问能力。
   */
  docsOn: boolean = false;
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
  private configChangeListeners: Array<() => void> = [];

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

  addConfigChangeListener(cb: () => void): () => void {
    this.configChangeListeners.push(cb);
    return () => {
      const i = this.configChangeListeners.indexOf(cb);
      if (i >= 0) this.configChangeListeners.splice(i, 1);
    };
  }

  private notifyConfigChangeListeners() {
    const snapshot = [...this.configChangeListeners];
    for (const cb of snapshot) {
      try {
        cb();
      } catch (e) {
        console.error("[WKRemoteConfig] config change listener threw", e);
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
      const previousDisableUserCreateSpace = this.disableUserCreateSpace;
      const previousMessagesSearchOn = this.messagesSearchOn;
      const previousSuppressLoginMigrationNotice =
        this.suppressLoginMigrationNotice;
      const previousStickerCustomEnabled = this.stickerCustomEnabled;
      const previousStickerUploadLimits = this.stickerUploadLimits;
      const previousDocsOn = this.docsOn;
      this.requestSuccess = true;
      this.revokeSecond = result["revoke_second"];
      this.threadOn = !!result["thread_on"];
      this.messagesSearchOn = parseRemoteBool(result["messages_search_on"]);
      this.disableUserCreateSpace = parseRemoteBool(
        result["disable_user_create_space"]
      );
      this.suppressLoginMigrationNotice = parseRemoteBool(
        result["suppress_login_migration_notice"]
      );
      this.stickerCustomEnabled = parseRemoteBool(
        result["sticker_custom_enabled"]
      );
      this.stickerUploadLimits = parseStickerUploadLimits(
        result["sticker_upload_limits"]
      );
      this.docsOn = parseRemoteBool(result["docs_on"]);
      this.oidcProviders = parseOidcProviders(result["oidc_providers"]);
      // 仅首次成功通知, 后续重新拉取(重连/手动刷新)不重复打扰订阅方。
      if (!wasSuccessful) this.notifyListeners();
      if (
        previousDisableUserCreateSpace !== this.disableUserCreateSpace ||
        previousMessagesSearchOn !== this.messagesSearchOn ||
        previousSuppressLoginMigrationNotice !==
          this.suppressLoginMigrationNotice ||
        previousStickerCustomEnabled !== this.stickerCustomEnabled ||
        !stickerUploadLimitsEqual(
          previousStickerUploadLimits,
          this.stickerUploadLimits
        ) ||
        previousDocsOn !== this.docsOn
      ) {
        this.notifyConfigChangeListeners();
      }
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
   * OCTO 实名认证状态缓存（GH #1121）。
   *
   * 数据源从「MeInfo 页主动 fetch self channelInfo」升级为
   * 「登录 API response 直接下发」（对应后端改动）。`loginSuccess()`
   * 会把 `/v1/user/login`、`/v1/user/current` 响应的 `realname_verified` /
   * `real_name` / `realname_verified_at` 映射到这三个字段，MeInfo 仍然保留
   * 作为刷新入口。
   *
   * **Tri-state 语义（血泪教训）**：
   *   - `true`   → 已实名
   *   - `false`  → 明确未实名（后端返回 false）
   *   - `undefined` → **尚未知道**（老后端未下发字段 / 字段缺失 / 加载中）
   *
   * `undefined` 和 `false` **必须区分**：
   *   - `=== true` 严格判断才能展示徽章 / 覆盖 displayName，防止在「未知」
   *     状态下错误地把人显示成未实名或把 real_name 覆盖成 undefined。
   *   - `save()` 在 `undefined` 时**不得**落盘成 `"0"`（= false），否则
   *     load() 回来就变成了 "明确未实名"，fresh-login 之后的刷新链路里
   *     无法区分 "字段缺失" 和 "明确 false"。R9 的 listener 兜底
   *     就是因为 save() 把 undefined 序列化成 "0" 才永远触发不了。
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
    // 实名认证状态 — 严格 tri-state 持久化。
    //   undefined → 删除 key（区别于「明确未实名」）
    //   true      → "1"
    //   false     → "0"
    // 禁止把 undefined 塌陷成 "0"（R9 的死循环根因）。
    if (this.realnameVerified === undefined) {
      this.removeStorageItemForSID("realname_verified");
    } else {
      this.setStorageItemForSID("realname_verified", this.realnameVerified ? "1" : "0");
    }
    if (this.realName === undefined || this.realName === "") {
      this.removeStorageItemForSID("real_name");
    } else {
      this.setStorageItemForSID("real_name", this.realName);
    }
    if (this.realnameVerifiedAt === undefined) {
      this.removeStorageItemForSID("realname_verified_at");
    } else {
      this.setStorageItemForSID("realname_verified_at", String(this.realnameVerifiedAt));
    }
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
    if (consumeOidcPostLogoutCleanup()) {
      this.logout();
      clearAuthStorage();
    }
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
    // 恢复实名认证状态缓存 — 严格 tri-state。
    //   key 缺失（getStorageItemForSID 返回 null） → undefined（未知，保持空白）
    //   "1" → true
    //   "0" → false（明确未实名）
    // 不要用 `=== "1"` 把 null 塌陷成 false —— 那样和 save() 塌陷 undefined
    // 一样会丢失「未知」语义，后续 loginSuccess() 即使下发正确值也会被
    // load 出来的假值淹没（R9 死循环根因）。
    const rvStr = this.getStorageItemForSID("realname_verified");
    if (rvStr === "1") {
      this.realnameVerified = true;
    } else if (rvStr === "0") {
      this.realnameVerified = false;
    } else {
      this.realnameVerified = undefined;
    }
    const storedRealName = this.getStorageItemForSID("real_name");
    this.realName = storedRealName ? storedRealName : undefined;
    const verifiedAtStr = this.getStorageItemForSID("realname_verified_at");
    if (verifiedAtStr) {
      const n = Number(verifiedAtStr);
      this.realnameVerifiedAt = Number.isFinite(n) && n > 0 ? n : undefined;
    } else {
      this.realnameVerifiedAt = undefined;
    }
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
    this.uid = "";
    this.shortNo = "";
    this.name = "";
    this.isWork = false;
    this.sex = 0;
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
    // 清除实名认证缓存
    this.realnameVerified = undefined;
    this.realName = undefined;
    this.realnameVerifiedAt = undefined;
    this.removeStorageItemForSID("realname_verified");
    this.removeStorageItemForSID("real_name");
    this.removeStorageItemForSID("realname_verified_at");
  }

  /**
   * 自己 displayName 的统一出口。
   *
   * 展示规则：已实名 (`realnameVerified === true`) + `realName` 非空
   *   → 返回 `realName`；否则返回 `name`（或空串）。
   *
   * 适用位置：自己气泡名字 / 头像卡 / MeInfo / 任何
   * `message.fromUID === WKApp.loginInfo.uid` 的 sender name 渲染。
   *
   * 与 `Utils/displayName.displayName()` 的差异：
   *   - 后者接收 `DisplayNameUser`（他人 / 群成员 orgData）；
   *   - self 的权威字段 在 `WKApp.loginInfo` 上（后端登录 payload 直发，
   *     不走 channelInfo 路径），因此需要独立 helper。
   *
   * `=== true` 严格判断：realnameVerified 是 tri-state，undefined（数据未到）
   * 不能降级成「未实名」把 realName 漏掉；反过来 false（明确未实名）也不
   * 应走 realName 分支。
   */
  public selfDisplayName(): string {
    if (
      this.realnameVerified === true &&
      typeof this.realName === "string" &&
      this.realName.length > 0
    ) {
      return this.realName;
    }
    return this.name || "";
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
  // channelID_channelType → my source_space_id 缓存（仅在我作为外部成员加入该群时有值）
  // 由 conversation sync 响应（octo-server PR#154 起携带 my_source_space_id）预填，
  // 用于在 subscriber.orgData 未加载完成时避免 shouldSkipChannelForSpace 误过滤外部群。
  channelMySourceSpaceMap: Map<string, string> = new Map();
  spaceChecked: boolean = false; // Space 检查是否完成
  deviceName: string = ""; // 设备名称
  deviceModel: string = ""; // 设备型号
  private remoteConfigForegroundRefreshStarted: boolean = false;
  private lastRemoteConfigForegroundRefreshAt: number = 0;

  set notificationIsClose(v: boolean) {
    this._notificationIsClose = v;
    StorageService.shared.setItem("NotificationIsClose", v ? "1" : "");
  }

  get notificationIsClose() {
    return this._notificationIsClose;
  }

  // app启动
  startup() {
    if (consumeOidcPostLogoutCleanup()) {
      this.clearLocalLoginState();
    }
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
        } else if (status === ConnectStatus.Connected) {
          // 第二层防御：重连成功后清除所有残留 typing。
          // SDK 重连只 reSubscribe，不补拉离线消息/CMD，断连期间 bot 回复经
          // HTTP sync 落库不触发清除路径 → typing 永不清。放全局单例 listener
          // （生命周期最长），不放 Chat/vm.ts（随页面卸载注销）。
          TypingManager.shared.resetAll();
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
    this.setupRemoteConfigForegroundRefresh();
  }

  private setupRemoteConfigForegroundRefresh() {
    if (
      this.remoteConfigForegroundRefreshStarted ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    this.remoteConfigForegroundRefreshStarted = true;

    const refresh = () => {
      this.refreshRemoteConfigOnForeground();
      // 回前台时通知当前会话重同步成员列表。合盖/息屏久后 WS 可能已断、
      // 断连期间的成员变更 CMD 已丢失，仅靠 remoteConfig 刷新不会补成员，
      // 导致 @ 提及弹窗搜不到新龙虾/成员（octo-web#567）。
      WKApp.mittBus.emit("wk:app-foreground");
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refresh();
        // 第一层防御：回前台清除所有残留 typing，对齐 iOS appDidBecomeActive。
        TypingManager.shared.resetAll();
      }
    });
    window.addEventListener("focus", refresh);
  }

  private refreshRemoteConfigOnForeground() {
    const now = Date.now();
    if (now - this.lastRemoteConfigForegroundRefreshAt < 5000) return;
    this.lastRemoteConfigForegroundRefreshAt = now;
    WKApp.remoteConfig.requestConfig().catch((e) => {
      console.warn("[WKRemoteConfig] foreground refresh failed", e);
    });
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
      })
      .catch((err) => {
        // 设备记录不存在（status===400）或其它读取失败时，仅记录告警以消除
        // unhandled promise rejection；不写 clientMsgDeviceId，保持原值降级运行。
        // 服务端暂无设备注册端点，此处不做注册，仅兜底。
        const notFound = err?.status === 400;
        console.warn(
          `[startMain] fetch device record failed${notFound ? " (device not found)" : ""}`,
          { deviceId: WKApp.shared.deviceId, status: err?.status, code: err?.code }
        );
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
  private clearLocalLoginState() {
    WKApp.loginInfo.logout();
    clearAuthStorage();
    this.currentSpaceId = "";
    this.channelSpaceMap.clear();
    this.channelMySourceSpaceMap.clear();
    this.spaceChecked = false;
  }

  // 登出
  logout() {
    this.clearLocalLoginState();
    window.location.reload();
  }

  async logoutUserInitiated() {
    const providerId = WKApp.loginInfo.loginProvider;
    const token = WKApp.loginInfo.token || "";
    if (isOidcLoginProvider(providerId) && token) {
      try {
        const resp = await requestOidcLogout(providerId, token);
        const rawEndSessionUrl = safeEndSessionUrl(resp.end_session_url);
        const endSessionUrl =
          rawEndSessionUrl && import.meta.env.DEV
            ? overridePostLogoutRedirectUri(
                rawEndSessionUrl,
                import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI
              )
            : rawEndSessionUrl;
        if (endSessionUrl) {
          this.clearLocalLoginState();
          markOidcPostLogoutCleanup();
          window.location.href = endSessionUrl;
          return;
        }
      } catch (e) {
        console.warn("OIDC logout failed, falling back to local logout", e);
      }
    }
    this.logout();
  }

  avatarChannel(channel: Channel) {
    if (!channel) {
      return "";
    }
    let avatarTag = this.getChannelAvatarTag(channel);
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    // 群已解散（企业微信式只读态）：用默认灰色头像替代群 logo，视觉上"群已遣散"。
    // 放在 logo 判断之前，确保即便缓存里残留旧 logo 也会被覆盖（A 数据 + B 皮肤）。
    if (
      channel.channelType === ChannelTypeGroup &&
      channelInfo?.orgData?.status === GroupStatusDisband
    ) {
      return DISBANDED_GROUP_AVATAR;
    }
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
