/**
 * Vite 注入的 import.meta.env 类型声明（dmworkbase 包）。
 *
 * dmworkbase 的 tsconfig 未引入 vite/client 类型，导致包级 tsc 对
 * `import.meta.env.*` 报 TS2339（featureFlags.ts 的 DEV、versionChecker.ts 的
 * VITE_APP_VERSION 等）。此处自包含声明 DEV/PROD/MODE 与所有 VITE_* 变量，
 * 不依赖 vite/client 在本包 node_modules 是否可解析。对齐 dmworklogin 的
 * vite-env.d.ts 做法。
 */

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  /**
   * octo-dap 采集端 base URL。缺省(未设/空) = 相对路径，埋点走业务域名内部转发到
   * 采集端；设为绝对地址(如 https://dap.example.com) = 直连外部采集域名，支持
   * octo-dap 采集端独立部署 / 外部域名而非内部转发。构建期由 CI 注入。
   */
  readonly VITE_DAP_COLLECT_BASE_URL?: string
  readonly [key: `VITE_${string}`]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
