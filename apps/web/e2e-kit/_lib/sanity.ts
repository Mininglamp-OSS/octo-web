/* eslint-disable no-undef -- e2e code runs in Node, process is available */
import { expect, type Page, type Request, type Response } from "@playwright/test";

/**
 * 通用 sanity 检查 (kit 提供的运行时).
 *
 * 每个 case 的 test body 结尾调用 `await sanityCheck(page, ctx)`.
 *
 * ## 检查项
 *
 * 1. **URL 不在登录页**: case 跑完页面不能被 401 拦截器踢回登录页.
 *    这是 mock 未覆盖某 endpoint 时最常见的沉默失败.
 *
 * 2. **无跨域请求走真后端**: 全部走 mock 模式, 任何 request 的 URL host
 *    不应该出现真后端域名 (由接入方配置 `realHosts`).
 *    需要在 test 开始时先调 `startRequestMonitor(page, config)` 起监听.
 *
 * 3. **无 API 401 响应**: 未拦的相对路径请求经 vite proxy 转真后端拿 401 ——
 *    浏览器看到的是 same-origin `/v1/*`, 检查项 2 抓不到.
 *    用 `page.on('response')` 抓 API 前缀 (由接入方配置 `apiPrefixRe`) 的 401 响应,
 *    直接暴露"mock 遗漏 endpoint".
 *
 * ## 为什么不改 MSW worker 的 onUnhandledRequest
 *
 * 常见的 `onUnhandledRequest: "warn"` 只警告不拒, 不算失败.
 * kit 走的是"测试层用 Playwright request/response 事件监听兜底"路线, 一律失败.
 */

/**
 * Sanity 配置 (接入方传入项目专属信息).
 *
 * @example
 *   const sanityConfig: SanityConfig = {
 *     realHosts: ['api.example.com', 'auth.example.com'],
 *     apiPrefixRe: /^\/(api|v1)(\/|$)/,
 *     loginPathRe: /\/login(\?|$)/,
 *   }
 */
export interface SanityConfig {
  /** 真后端 host 关键字列表, request URL 命中就算漏 mock */
  realHosts: string[];
  /** API 前缀 regex, 匹配的相对路径 401 就算漏 mock */
  apiPrefixRe: RegExp;
  /** 登录页 URL regex, case 跑完不该被踢到这里 */
  loginPathRe?: RegExp;
}

const DEFAULT_LOGIN_PATH_RE = /\/login(\?|$)/;

export interface SanityContext {
  /** 跨域请求收集器, `startRequestMonitor` 返回 */
  realRequests: Request[];
  /** API 401 响应收集器 (暴露 mock 遗漏 endpoint) */
  apiUnauthorized: Response[];
  /** 传入的配置, `sanityCheck` 复用 */
  config: SanityConfig;
}

/**
 * 在 test 开头调用, 返回 ctx 供 `sanityCheck` 用.
 *
 * @example
 *   const ctx = startRequestMonitor(authedPage, sanityConfig)
 *   // ... case body ...
 *   await sanityCheck(authedPage, ctx)
 */
export function startRequestMonitor(page: Page, config: SanityConfig): SanityContext {
  const realRequests: Request[] = [];
  const apiUnauthorized: Response[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (config.realHosts.some((h) => url.includes(h))) {
      realRequests.push(req);
    }
  });
  page.on("response", (res) => {
    if (res.status() !== 401) return;
    let path = "";
    try {
      path = new URL(res.url()).pathname;
    } catch {
      return;
    }
    if (!config.apiPrefixRe.test(path)) return;
    apiUnauthorized.push(res);
  });
  return { realRequests, apiUnauthorized, config };
}

/**
 * Case body 尾部必调. 任一项失败即 case 失败.
 */
export async function sanityCheck(page: Page, ctx: SanityContext): Promise<void> {
  const loginRe = ctx.config.loginPathRe ?? DEFAULT_LOGIN_PATH_RE;

  // 1. URL 不在登录页
  const url = page.url();
  expect(url, `case 跑完被踢到登录页, 通常是 mock 有 endpoint 没覆盖到`).not.toMatch(loginRe);

  // 2. 无真后端请求
  const hits = ctx.realRequests.map((r) => `${r.method()} ${r.url()}`);
  expect(
    hits,
    `case 期间有请求走到真后端 host (应全部被 mock 拦截):\n${hits.join("\n")}`,
  ).toEqual([]);

  // 3. 无 API 401 响应
  const unauth = ctx.apiUnauthorized.map((r) => `${r.request().method()} ${r.url()}`);
  expect(
    unauth,
    `case 期间有 API 请求返回 401 (相对路径经 vite proxy 转真后端, 说明 mock 未覆盖):\n${unauth.join("\n")}`,
  ).toEqual([]);
}
