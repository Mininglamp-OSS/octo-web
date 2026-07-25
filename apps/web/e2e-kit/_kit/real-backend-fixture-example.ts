/* eslint-disable no-undef -- e2e code runs in Node */
// @ts-nocheck — kit-provided starter, imports 相对 _kit/ 目录组织;
// 只有 cp 到 e2e/tests/_shared/ 后才 resolve. tsconfig 建议 exclude e2e/_kit/**/*.ts.
//
// **真接口 fixture starter** (kit v0.3 -> v0.4 反哺自 ooh-manual-ui 真接口验证).
//
// ## 用途
//
// 走真后端 (E2E_TARGET=test 模式) 的 authedPage fixture. 现场 curl 真后端拿 JWT
// + user info, 塞 localStorage 跳过 login 页 (captcha 天然绕开).
//
// ## 起手
//
//   cp e2e/_kit/real-backend-fixture-example.ts e2e/tests/_shared/fixtures-real.ts
//   # 填以下**项目占位** (共 8+ 项, 别漏):
//   #  1. BACKEND_URL              (真后端根 URL)
//   #  2. LOGIN_ENDPOINT           (登录接口路径)
//   #  3. USER_INFO_ENDPOINT       (拉用户信息接口)
//   #  4. AUTH_TOKEN_KEY           (token 存的 localStorage 键)
//   #  5. LOCALE_STORAGE_KEY       (locale localStorage 键, 可选留空)
//   #  6. MOCK_LOCALE              (locale 值)
//   #  7. LoginBody type shape     (POST body 字段名, e.g. userName/passWord)
//   #  8. buildExtraStorageKeys()  (从 /users/info 响应构造额外 localStorage map)
//   #  9. ENV_USER_VAR             (shell env 里凭据变量名, e.g. OOHCMS_UAT_USER)
//   # 10. ENV_PASS_VAR             (同上, pass)
//
// ## 使用
//
//   import { test, expect } from "./_shared/fixtures-real";
//   test("@my-case", async ({ authedPage }) => { ... });
//
// 需 shell env: <ENV_USER> + <ENV_PASS> (从 ~/.secrets/<org>/<service>.env source)
//
// ## 前置
//
// 1. 后端登录接口**不校验第三方 captcha ticket** —— 用 curl 打 login 只带
//    {userName, passWord} 若返 200 就 OK. 若后端真校验 → 走 backdoor 姿势,
//    参考 docs/methodology/real-backend-e2e.md 决策树.
// 2. vite.config.ts 里 proxy 已配 `/api/*` 转 `env.VITE_API_URL` (或其它)
// 3. 凭据放 vault: `~/.secrets/<org>/<service>.env` (see secrets-vault-layout skill)

import { test as base, expect, type Page } from "@playwright/test";

// ============================================================
// TODO(接入方): 按你项目改下面的常量, 然后删掉此 TODO 注释
// ============================================================
const BACKEND_URL = "<PROJECT_BACKEND_URL>";        // 例: "https://oohcms-uat.omnitechcn.com"
const LOGIN_ENDPOINT = "<PROJECT_LOGIN_ENDPOINT>";  // 例: "/api/auth/login"
const USER_INFO_ENDPOINT = "<PROJECT_USER_INFO_ENDPOINT>"; // 例: "/api/users/info"
const AUTH_TOKEN_KEY = "<PROJECT_AUTH_TOKEN_KEY>";  // 例: "OOh-Authorization"
const LOCALE_STORAGE_KEY = "<PROJECT_LOCALE_STORAGE_KEY>"; // 例: "myapp:locale"
const MOCK_LOCALE = "<PROJECT_MOCK_LOCALE>";        // 例: "zh-CN"

// Login POST body 字段名 (**每项目不同**, 别猜, 看项目 src/services/login 的实际 body)
type LoginBody = { userName: string; passWord: string };  // TODO: 改 shape

// User info 里 auth guard 会读的字段 → localStorage 键映射
// (对 kit v0.3 EXTRA_STORAGE_KEYS 模式的扩展, 支持从 API 响应动态取值)
function buildExtraStorageKeys(info: any): Record<string, string> {
  // TODO(接入方): 按你项目改. 例 (ooh-manual-ui):
  return {
    "ooh:permissions": JSON.stringify(info.permissions ?? []),
    "ooh:username": info.userName || "",
    "ooh:userId": String(info.userId || ""),
    "ooh:email": info.email || "",
    "ooh:loginType": info.loginType || "",
  };
}

// Shell env 里凭据变量名 (**每项目 vault 里叫什么就写什么**)
const ENV_USER_VAR = "<PROJECT_USER_ENV_VAR>";  // 例: "OOHCMS_UAT_USER"
const ENV_PASS_VAR = "<PROJECT_PASS_ENV_VAR>";  // 例: "OOHCMS_UAT_PASS"
// ============================================================

type Fixtures = { authedPage: Page };

export const test = base.extend<Fixtures>({
  authedPage: async ({ page }, use) => {
    const user = process.env[ENV_USER_VAR];
    const pass = process.env[ENV_PASS_VAR];
    if (!user || !pass) {
      throw new Error(
        `需 shell env: ${ENV_USER_VAR} + ${ENV_PASS_VAR}\n` +
        `例: source ~/.secrets/<org>/<service>.env && export ${ENV_USER_VAR} ${ENV_PASS_VAR}`,
      );
    }

    // (可选) 清 SW 缓存, 避免之前 mock 模式跑过的 SW 残留 warn
    // 若从来没跑过 mock 模式可注释掉
    // await page.evaluate(() =>
    //   navigator.serviceWorker?.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister())))
    // );

    // 1. 现场 curl 真后端拿 JWT
    const loginBody: LoginBody = { userName: user, passWord: pass };
    const loginRes = await page.request.post(`${BACKEND_URL}${LOGIN_ENDPOINT}`, {
      data: loginBody,
      headers: { "Content-Type": "application/json" },
    });
    const loginJson = await loginRes.json();
    const token = loginJson?.data?.token;  // TODO: 若项目返 shape 不同, 改这里
    if (!token) throw new Error(`login 失败: ${JSON.stringify(loginJson).slice(0, 200)}`);

    // 2. 拉 user info 拿 permissions 等
    const userInfoRes = await page.request.get(`${BACKEND_URL}${USER_INFO_ENDPOINT}`, {
      headers: { Authorization: token },
    });
    const userInfoJson = await userInfoRes.json();
    const info = userInfoJson?.data;
    if (!info) throw new Error(`拉 user info 失败: ${JSON.stringify(userInfoJson).slice(0, 200)}`);

    // 3. 塞 localStorage (auth guard beforeLoad 读)
    const extras = buildExtraStorageKeys(info);
    await page.addInitScript(
      ({ tokenKey, tokenStr, localeKey, localeVal, extraKeys }) => {
        localStorage.setItem(tokenKey, tokenStr);
        if (localeKey) localStorage.setItem(localeKey, localeVal);
        for (const [k, v] of Object.entries(extraKeys)) {
          localStorage.setItem(k, v);
        }
      },
      {
        tokenKey: AUTH_TOKEN_KEY,
        tokenStr: token,
        localeKey: LOCALE_STORAGE_KEY,
        localeVal: MOCK_LOCALE,
        extraKeys: extras,
      },
    );

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/403/);

    await use(page);
  },
});

export { expect };
