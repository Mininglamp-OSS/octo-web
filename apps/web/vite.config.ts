import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from "vite-plugin-commonjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = env.VITE_API_URL;

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
        resolveId(id, importer) {
          // 测试文件正则：匹配 .test.* / .spec.* 或 __tests__/ 目录
          const TEST_FILE_RE =
            /[/\\](?:__tests__[/\\]|.*\.(?:test|spec)\.[jt]sx?$)/;
          // 测试相关包：精确前缀匹配
          const TEST_PACKAGES = [
            "vitest",
            "expect-type",
            "@vitest/",
            "@storybook/addon-vitest",
            "@storybook/test",
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
              /\/(vitest|expect-type|@vitest\/|@storybook\/(addon-vitest|test))\//;
            const TEST_FILE_URL_RE = /\.(test|spec)\.[jt]sx?|__tests__\//;

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
        // Summary service API — must be before the general /api/ rule
        "/summary/api/v1": {
          target:
            env.VITE_SUMMARY_API_URL || apiOrigin || "http://localhost:8080",
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(/^\/summary/, ""),
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
