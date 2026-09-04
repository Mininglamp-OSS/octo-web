import React from 'react';
import { createRoot } from 'react-dom/client';
import '@octo/base/src/theme/tokens.css';
import '@octo/ui/styles.css';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import  { BaseModule, I18nProvider, i18n, WKApp, Dap, isElectronPowered } from '@octo/base';
import  { LoginModule, BindModule } from '@octo/login';
import  { DataSourceModule } from '@octo/datasource';
import {ContactsModule} from '@octo/contacts';
import { SummaryModule, startSummaryAttentionPolling } from '@dmwork/summary';
import { McpMarketModule } from '@dmwork/mcp';
import { SkillMarketModule } from '@dmwork/skillmarket';
import { AppBotModule } from '@dmwork/appbot';
import { registerEnterpriseModules } from 'virtual:octo-enterprise-modules';
import { MailModule } from '@octo/mail';
import { version as pkgVersion } from '../package.json';
import appEnUS from './i18n/en-US.json';
import appZhCN from './i18n/zh-CN.json';
import { resolveApiURL } from './apiURL';
import { LoopIcon } from './Components/Icons/LoopIcon';

// VITE_API_URL 只填 origin（协议+域名+端口），不要带路径
// 例如: https://api.example.com (而非 https://api.example.com/v1/)

// 正式 Electron 包通过 VITE_ELECTRON_BUILD 在编译期标记桌面运行时。
// preload 标记仍然保留，用于开发环境和 IPC 能力；但不能只依赖 preload 判断 API
// 环境，否则 preload 加载异常时会误走 Web 分支，把 `/api/v1/` 解析成 `file:///api/v1/`。
const isDesktopRuntime =
  Boolean((window as any).__TAURI_IPC__) ||
  isElectronPowered() ||
  import.meta.env.VITE_ELECTRON_BUILD === "true" ||
  window.location.protocol === "file:"

if(isDesktopRuntime) {
  // 开发环境的 Tauri/Electron 页面运行在 localhost:3000，走 Vite 同源代理，
  // 避免直接请求远程 API 时被浏览器 CORS 拦截。正式桌面包没有 Vite 代理，
  // 仍然使用 VITE_API_URL 直连后端。
  WKApp.apiClient.config.apiURL = resolveApiURL({
    isDesktop: true,
    isDev: import.meta.env.DEV,
    rawApiURL: import.meta.env.VITE_API_URL,
  })
} else {
  // Web 环境（DEV/PROD）统一走相对路径 /api/v1/
  // DEV: 由 Vite proxy 转发到 VITE_API_URL（保留 /api 前缀，后端直连）
  // PROD: 由 Nginx 反代到实际后端（Nginx 剥离 /api 前缀）
  WKApp.apiClient.config.apiURL = resolveApiURL({
    isDesktop: false,
    isDev: import.meta.env.DEV,
    rawApiURL: import.meta.env.VITE_API_URL,
  })
}

WKApp.apiClient.config.tokenCallback = ()=> {
  return WKApp.loginInfo.token
}
// 埋点上报通道带业务 token(后端据此鉴权并归一 actor)。回调注入避免 Dap import WKApp。
Dap.shared.setTokenProvider(() => WKApp.loginInfo.token)
// 由 APIClient request interceptor 读取当前 space_id，注入 X-Space-Id header。
// 通过回调注入（而非在 APIClient 内 import WKApp）以避免循环依赖。GH #1038
WKApp.apiClient.config.spaceIdCallback = () => {
  return WKApp.shared.currentSpaceId
}
WKApp.config.appVersion = import.meta.env.VITE_VERSION || pkgVersion
WKApp.config.appName = "Octo"

WKApp.loginInfo.load() // 加载登录信息
i18n.registerNamespace("app", {
  "zh-CN": appZhCN,
  "en-US": appEnUS,
})
i18n.init()
WKApp.config.locale = i18n.getLocale()
i18n.subscribe((locale) => {
  WKApp.config.locale = locale
  WKApp.menus.refresh()
  WKApp.shared.notifyListener()
})

WKApp.shared.registerModule(new BaseModule()); // 基础模块
WKApp.shared.registerModule(new DataSourceModule()) // 数据源模块
WKApp.shared.registerModule(new LoginModule()); // 登录模块
WKApp.shared.registerModule(new BindModule()); // OIDC 自助绑定页 (/oidc/bind)
WKApp.shared.registerModule(new ContactsModule()); // 联系模块
WKApp.shared.registerModule(new SummaryModule()); // 智能总结模块
WKApp.shared.registerModule(new McpMarketModule()); // MCP 市场模块
WKApp.shared.registerModule(new SkillMarketModule()); // Skill 市场模块
WKApp.shared.registerModule(new AppBotModule()); // App Bot 模块
registerEnterpriseModules({
  registerModule: (module) => WKApp.shared.registerModule(module),
});
// Loop is supplied through the enterprise module slot, outside this OSS tree.
// Keep its approved host artwork at the app composition boundary instead of
// branching on enterprise business ids inside the shared NavRail renderer.
WKApp.menus.registerIconOverride("loop", <LoopIcon />);
WKApp.menus.registerIconOverride("dmloop", <LoopIcon />);
WKApp.shared.registerModule(new MailModule()); // Agent Mail workspace

// e2e mock: 仅在 VITE_E2E_MOCK=1 时启动 MSW Service Worker.
// dev / prod 完全走 tree-shake 分支, 无副作用. 必须在 startup() 之前 await,
// 否则第一发 fetch (common/appconfig) 会漏 mock.
// 暴露 worker + http/HttpResponse 到 window, 让 e2e spec 用 worker.use(...)
// 动态覆盖 handler 支持有状态场景 (page.route 拦不到 MSW SW 层).
async function enableMocksIfE2E(): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK !== "1") return;
  try {
    const { worker } = await import("./mocks/browser");
    const msw = await import("msw");
    const { waitForServiceWorkerControl, MSW_CONTROL_TIMEOUT_MS, waitForMockInterception, MSW_PROBE_TIMEOUT_MS } =
      await import("./mocks/swControl");
    await worker.start({ onUnhandledRequest: "bypass" });
    // start() 之后还要等真正【接管】: 否则 __MSW_READY__ 会在 SW 尚未 control 本
    // client 时就变成 true, boot 期间的请求绕过 MSW 直达 dev server, 在 e2e 上表现
    // 为 "proxy errors" (详见 mocks/swControl.ts 的注释).
    // 这个 await 同时把 __MSW_READY__ 的语义修正成它一直声称的那个:
    // 「从现在起请求会被拦」—— 二十多个 spec 和 e2eReady 都以它为 boot 闸门.
    const controlled = await waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS);
    if (!controlled) {
      // 降级: 仍然放行 boot (卡死 boot 比漏一个请求糟得多). 打印出来让 e2e 失败时
      // 能一眼定位, 而不是从一堆 proxy error 里反推.
      console.warn(
        `[e2e] MSW worker started but did not take control within ${MSW_CONTROL_TIMEOUT_MS}ms; ` +
          "boot-time requests may bypass mocks",
      );
    }
    // 接管到位【仍不等于】本 document 会被拦: MSW 只对登记过的 client 施加 mock,
    // 而一个 spec 内的第二次导航会让 controller 立刻非空 (SW 早已激活) 却还没登记完,
    // 接管等待因此一拍都不等就通过 —— 这是 @S26 那类多次导航 spec 上概率性泄漏的
    // 真正成因. 所以不再推断, 直接实测一发: 打一个只有 MSW 才会应答的探针.
    const intercepting = await waitForMockInterception(MSW_PROBE_TIMEOUT_MS);
    if (!intercepting) {
      console.warn(
        `[e2e] MSW did not intercept a probe request within ${MSW_PROBE_TIMEOUT_MS}ms; ` +
          "requests may bypass mocks",
      );
    }
    const w = window as unknown as {
      __MSW_READY__: boolean;
      __msw?: { worker: typeof worker; http: typeof msw.http; HttpResponse: typeof msw.HttpResponse };
    };
    w.__msw = { worker, http: msw.http, HttpResponse: msw.HttpResponse };
    w.__MSW_READY__ = true;
  } catch (e) {
    // MSW SW 拿不到 (如 e2e no-mock scenario 拦了 mockServiceWorker.js): 静默继续,
    // 让 app 正常启动. __MSW_READY__ 不 set, no-mock spec 也不 wait 它.
    console.warn("[e2e] MSW disabled:", e);
  }
}

// e2e mock: 仅在 VITE_E2E_MOCK_IM=1 时挂 fake IM provider 钩子, 让 spec 里
// installMockImRuntime(page, seed) 能生效. DataSourceModule.init() 和
// App.connectIM 已用同一 flag 跳过真实 IM callback / connect.
// dev / prod 完全走 tree-shake 分支, 无副作用.
async function enableMockImIfE2E(): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK_IM !== "1") return;
  try {
    const mod = await import("../e2e-kit/_kit/mock-im-runtime/fake-provider");
    const wksdk = await import("wukongimjssdk");
    (window as unknown as {
      __installMockImRuntime__: (s: unknown) => void;
      WKSDK: typeof wksdk.WKSDK;
    }).__installMockImRuntime__ = mod.installFakeProvider as unknown as (s: unknown) => void;
    // 暴露 WKSDK 让 spec / fixture 直接调 shared().connectManager.notifyConnectStatusListeners 等
    (window as unknown as { WKSDK: typeof wksdk.WKSDK }).WKSDK = wksdk.WKSDK;
  } catch (e) {
    console.warn("[e2e] mock-im-runtime disabled:", e);
  }
}

async function main(): Promise<void> {
  await enableMocksIfE2E();
  await enableMockImIfE2E();
  WKApp.shared.startup(); // app启动
  // 启动智能总结的兜底轮询。必须【放在 startup() 之后】而不是让 SummaryModule.init()
  // 立刻启动: init() 在模块顶层语句里同步执行 (registerModule), 比 enableMocksIfE2E()
  // 更早 —— 若 leader.start() 里 promote() 立刻 void tick(), 第一发 fetch 会在 MSW 还没
  // 激活前就排上 microtask, 直达 vite proxy, e2e 下 fail-closed. 见 dmworksummary/module.tsx
  // 里 startSummaryAttentionPolling 的注释。startup() 之后调, loginInfo 已 load、
  // Space 列表开始拉 (首刷由 space-ready 触发); 未登录 / 无 Space 时第一拍读自己 return null.
  startSummaryAttentionPolling();
  // 埋点蒙版底座(octo-dap 采集方案):启动时初始化一次,装事件委托 / MutationObserver /
  // fetch-XHR 包裹 / 卸载兜底。默认 ship dark(fail-closed,不采),仅当 remoteConfig 下发
  // tracking_enabled 为真时才开采;字段缺失 / false / 拉取失败一律不采,前端一个请求都不发
  // (见 App.tsx requestConfig)。全程自吞异常,失败不影响业务。
  Dap.shared.init();

  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>
  );
  reportWebVitals();
}

// Initialize Electron notification bridge if running in Electron

void main();
