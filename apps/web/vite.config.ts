import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from "vite-plugin-commonjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = env.VITE_API_URL;
  const isElectronBuild = env.VITE_ELECTRON_BUILD === "true";

  // 提取 origin
  let apiOrigin: string;
  if (!apiUrl) {
    // 未配置时打印警告，fallback 到本地（proxy 将指向本地，请求会失败，但 dev server 可以正常启动）
    console.warn(
      "[vite] ⚠️  VITE_API_URL is not set. API requests will fail. Please add it to apps/web/.env.local, e.g.: VITE_API_URL=https://api.example.com"
    );
    apiOrigin = "http://localhost:8080";
  } else {
    try {
      apiOrigin = new URL(apiUrl).origin;
      if (mode === "development") {
        console.log(`[vite] ✅ API proxy configured: /api/* -> ${apiOrigin}/*`);
      }
    } catch {
      throw new Error(
        `[vite] VITE_API_URL format is invalid: "${apiUrl}". Please use full URL, e.g. https://api.example.com`
      );
    }
  }

  return {
    // Electron loads the production entry through file://, so its assets must
    // be relative to index.html. Keep the web build rooted at /.
    base: isElectronBuild ? "./" : "/",
    plugins: [
      // 在 HTML <head> 注入 <meta name="app-version">，供构建后验证版本号是否正确写入
      {
        name: "inject-app-version-meta",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              injectTo: "head",
              attrs: {
                name: "app-version",
                content: process.env.VITE_APP_VERSION ?? "dev",
              },
            },
          ];
        },
      },
      // TODO: remove after all require() calls are migrated to import (chore/migrate-require-to-import)
      commonjs(),
      react(),
      tsconfigPaths({ root: "../../" }),
      {
        name: "exclude-test-files",
        // enforce: "pre" 让本插件的 resolveId 早于 commonjs() 等其它插件执行。
        // filehelper.ts 里 require(`./${fileIcon}`) 会被 vite-plugin-commonjs 展开
        // 成对整个目录的 glob 引用，把同级的 *.test.* / __tests__/* 一并扫进生产
        // 依赖图。若不抢在 commonjs() 之前 resolve，这些测试文件会先被 commonjs()
        // 拿走、绕过本 stub，最终把 vitest / @vitest/mocker(vi.queueMock) 打进生产
        // bundle，加载即抛、React 挂不上 → 白屏。
        enforce: "pre",
        resolveId(id, importer) {
          // 测试文件正则：匹配 .test.* / .spec.* / .stories.* 或 __tests__/ 目录
          const TEST_FILE_RE =
            /[/\\](?:__tests__[/\\]|.*\.(?:test|spec|stories)\.[jt]sx?$)/;
          // 测试态相关包：精确前缀匹配。涵盖 vitest 运行时、Storybook 运行时
          // (@storybook/react-vite / @storybook/test / addon-vitest 等) 及
          // @testing-library/*（user-event 会传递依赖到 @vitest/mocker）。
          const TEST_PACKAGES = [
            "vitest",
            "expect-type",
            "@vitest/",
            "@storybook/",
            "@testing-library/",
          ];

          const isTestFile = TEST_FILE_RE.test(id);
          const isTestPackage = TEST_PACKAGES.some(
            (pkg) =>
              id === pkg ||
              id.startsWith(pkg) ||
              id.includes(`/node_modules/${pkg}`)
          );

          if (isTestFile || isTestPackage) {
            return "\0vitest-stub";
          }
        },
        load(id) {
          if (id === "\0vitest-stub") {
            return "export default {}";
          }
        },
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || "";
            const TEST_URL_RE =
              /\/(vitest|expect-type|@vitest\/|@storybook\/|@testing-library\/)/;
            const TEST_FILE_URL_RE =
              /\.(test|spec|stories)\.[jt]sx?|__tests__\//;

            if (TEST_URL_RE.test(url) || TEST_FILE_URL_RE.test(url)) {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/javascript");
              res.end("export default {}");
              return;
            }
            next();
          });
        },
      },
    ],
    resolve: {
      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
      dedupe: ["react", "react-dom"],
    },
    build: {
      outDir: "build",
      sourcemap: false,
    },
    server: {
      port: env.VITE_PORT ? Number(env.VITE_PORT) : 3000,
      host: env.VITE_HOST ?? true,
      proxy: {
        // Docs service API — must be before the general /api/ rule
        "/api/v1/docs": {
          target: env.VITE_DOCS_API_URL || "http://localhost:4000",
          changeOrigin: true,
          secure: false,
        },
        // Summary service API — must be before the general /api/ rule
        "/summary/api/v1": {
          target:
            env.VITE_SUMMARY_API_URL || apiOrigin || "http://localhost:8080",
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(/^\/summary/, ""),
        },
        // Marketplace (MCP catalog) API — must be before the general /api/ rule.
        // octo-marketplace serves its own /api/v1/*; the /market prefix is
        // stripped here (dev) and by nginx (prod). See octo-marketplace
        // docs/api/mcp-v1.md §0.
        "/market/api/v1": {
          target:
            env.VITE_MARKET_API_URL || "http://127.0.0.1:8092",
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(/^\/market/, ""),
        },
        // Matters service API — must be before the general /api/ rule
        // When target is the main gateway (nginx), no rewrite needed — nginx routes /matter/* to todos service.
        // When target is todos service directly (e.g. localhost:3000), set VITE_MATTER_API_URL and add rewrite.
        "/matter/api/v1": {
          target: env.VITE_MATTER_API_URL || env.VITE_TODO_API_URL || apiOrigin,
          changeOrigin: true,
          secure: false,
          rewrite: env.VITE_MATTER_API_URL
            ? (path: string) => path.replace(/^\/matter/, "")
            : undefined,
        },
        // Loop (fleet) service API — 真实 multica-server/fleet 联调。
        // dev fleet 在 127.0.0.1:8091 直接提供完整 /fleet/api/v1/... 路径（不 strip）。
        // 必须放在下面通用 /fleet/api/ 规则之前（vite first-match）。
        "/fleet/api/v1": {
          target: env.VITE_FLEET_API_URL || "http://127.0.0.1:8091",
          changeOrigin: true,
          secure: false,
        },
        // fleet 经 /fleet/api 段挂载 (fleet api.go A.1: `fleet/api` segment 由
        // nginx 添加并 strip 转 fleet /v1)。一条规则覆盖所有 fleet 端点,
        // 无需逐个路径列举。必须在 /api/ catch-all 之前 (vite first-match)。
        // Note: bot feed (/bots/:uid/feed) 由 matter 直供 (上面 /matter/api/v1);
        // daemon 客户端直连 OCTO_FLEET_URL + /v1/...，不经此代理。
        "/fleet/api/": {
          target: env.VITE_FLEET_API_URL || "http://127.0.0.1:8092",
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(/^\/fleet\/api/, ""),
        },
        "/api/": {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
        // OIDC SSO endpoints (backend mounts these at /v1/ directly, no /api prefix)
        "/v1/": {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
        "/version.json": {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
        "/ws/": {
          target: apiOrigin.replace(/^https?/, (m) =>
            m === "https" ? "wss" : "ws"
          ),
          changeOrigin: true,
          secure: false,
          ws: true, // 启用 WebSocket 代理
        },
      },
    },
    optimizeDeps: {
      exclude: [
        "vitest",
        "expect-type",
        "@vitest/runner",
        "@vitest/expect",
        "@vitest/spy",
        "@vitest/utils",
        "@vitest/snapshot",
        "@storybook/addon-vitest",
        "@storybook/test",
      ],
      entries: [
        "src/**/*.{ts,tsx}",
        // Negation patterns: Vite passes these to fast-glob, which supports "!" prefix
        // Verified working in Vite 6.x (run `npx vite optimize --force` to check)
        "!src/**/*.{test,spec}.{ts,tsx}",
        "!src/__tests__/**",
        "!vitest*.config.ts",
      ],
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
      "process.env.PUBLIC_URL": '""',
    },
    envPrefix: "VITE_",
  };
});
