import React from 'react';
import { createRoot } from 'react-dom/client';
import '@octo/base/src/theme/tokens.css';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import  { BaseModule, I18nProvider, ensureSessionSid, i18n, stripSessionSidFromUrl, WKApp } from '@octo/base';
import  { LoginModule, BindModule } from '@octo/login';
import  { DataSourceModule } from '@octo/datasource';
import {ContactsModule} from '@octo/contacts';
import { MatterModule } from '@octo/todo';
import { SummaryModule } from '@dmwork/summary';
import { AppBotModule } from '@dmwork/appbot';
import { DocsModule } from '@octo/docs';
import { LoopModule } from '@octo/loop';
import { PersonalModule } from '@octo/personal';
import { version as pkgVersion } from '../package.json';
import appEnUS from './i18n/en-US.json';
import appZhCN from './i18n/zh-CN.json';

// VITE_API_URL 只填 origin（协议+域名+端口），不要带路径
// 例如: https://api.example.com (而非 https://api.example.com/v1/)

if((window as any).__TAURI_IPC__ || (window as any)?.__POWERED_ELECTRON__) {
  // Tauri/Electron 需要完整 API URL
  const rawApiURL = import.meta.env.VITE_API_URL
  if (!rawApiURL) {
    throw new Error('VITE_API_URL is required for Tauri/Electron. Please set it in .env.local (e.g., VITE_API_URL=https://api.example.com)')
  }
  // 提取 origin，防止旧格式导致双拼路径
  let apiURL: string
  try {
    apiURL = new URL(rawApiURL).origin
  } catch {
    throw new Error(`VITE_API_URL format is invalid: "${rawApiURL}". Please use full URL, e.g. https://api.example.com`)
  }
  WKApp.apiClient.config.apiURL = apiURL + "/v1/"
} else {
  // Web 环境（DEV/PROD）统一走相对路径 /api/v1/
  // DEV: 由 Vite proxy 转发到 VITE_API_URL（保留 /api 前缀，后端直连）
  // PROD: 由 Nginx 反代到实际后端（Nginx 剥离 /api 前缀）
  WKApp.apiClient.config.apiURL = "/api/v1/"
}

WKApp.apiClient.config.tokenCallback = ()=> {
  return WKApp.loginInfo.token
}
// 由 APIClient request interceptor 读取当前 space_id，注入 X-Space-Id header。
// 通过回调注入（而非在 APIClient 内 import WKApp）以避免循环依赖。GH #1038
WKApp.apiClient.config.spaceIdCallback = () => {
  return WKApp.shared.currentSpaceId
}
WKApp.config.appVersion = import.meta.env.VITE_VERSION || pkgVersion
WKApp.config.appName = "Octo"

ensureSessionSid()
stripSessionSidFromUrl()
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
WKApp.shared.registerModule(new MatterModule()); // Matter module
WKApp.shared.registerModule(new SummaryModule()); // 智能总结模块
WKApp.shared.registerModule(new AppBotModule()); // App Bot 模块
WKApp.shared.registerModule(new DocsModule()); // Docs module
WKApp.shared.registerModule(new LoopModule()); // Loop 面板（Issue/Skill/Project/Agent/Squad/Runtime）
WKApp.shared.registerModule(new PersonalModule()); // 我的（Runtimes/Skills）

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
    await worker.start({ onUnhandledRequest: "bypass" });
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

async function main(): Promise<void> {
  await enableMocksIfE2E();
  WKApp.shared.startup(); // app启动

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
