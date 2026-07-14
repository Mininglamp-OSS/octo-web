import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from "vite-plugin-commonjs";
import { fileViewerRenderers } from "@file-viewer/vite-plugin";

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
      fileViewerRenderers({
        copyAssets: true,
        chunkStrategy: "renderer",
      }),
      react(),
      tsconfigPaths({ root: "../../" }),
      {
        name: "fix-xmldom-cjs",
        enforce: "pre",
        buildStart() {
          const { buildSync } = require("esbuild");
          const fs = require("fs");
          const path = require("path");
          const root = process.cwd();
          const outDir = path.join(root, "node_modules", ".vite");
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outFile = path.join(outDir, "xmldom-esm.js");
          const xmldomPath = require.resolve("@xmldom/xmldom", { paths: [path.join(root, "../../")] });
          buildSync({
            entryPoints: [xmldomPath],
            bundle: true,
            format: "esm",
            outfile: outFile,
            logLevel: "silent",
          });
          // esbuild only emits `export default require_index();` for CJS.
          // Append named exports so `import { DOMParser }` works.
          let code = fs.readFileSync(outFile, "utf-8");
          const lastExport = "export default require_index();";
          const idx = code.lastIndexOf(lastExport);
          if (idx !== -1) {
            const named = "var __xmldom = require_index();\nexport default __xmldom;\nexport const DOMParser = __xmldom.DOMParser;\nexport const XMLSerializer = __xmldom.XMLSerializer;\nexport const DOMImplementation = __xmldom.DOMImplementation;\nexport const DOMException = __xmldom.DOMException;\nexport const Node = __xmldom.Node;\nexport const Element = __xmldom.Element;\nexport const Document = __xmldom.Document;\nexport const Attr = __xmldom.Attr;\nexport const Text = __xmldom.Text;\nexport const Comment = __xmldom.Comment;\nexport const MIME_TYPE = __xmldom.MIME_TYPE;\nexport const NAMESPACE = __xmldom.NAMESPACE;\n";
            code = code.slice(0, idx) + named;
            fs.writeFileSync(outFile, code, "utf-8");
          }
        },
        resolveId(id) {
          const path = require("path");
          if (id === "@xmldom/xmldom" || (id.includes("@xmldom/xmldom/lib/index") && !id.includes("?") && !id.includes("xmldom-esm"))) {
            return path.join(process.cwd(), "node_modules", ".vite", "xmldom-esm.js");
          }
        },
      },
      {
        name: "bundle-spreadsheet-worker",
        enforce: "pre",
        buildStart() {
          const { buildSync } = require("esbuild");
          const fs = require("fs");
          const path = require("path");
          const root = process.cwd();
          const outDir = path.join(root, "public", "vendor", "xlsx");
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outFile = path.join(outDir, "sheet.worker.js");
          const workerEntry = path.join(
            root, "../../node_modules/.pnpm/@file-viewer+renderer-spreadsheet@2.1.27/node_modules/@file-viewer/renderer-spreadsheet/dist/spreadsheet/worker/sheetjs/sheet.worker.js"
          );
          // Create a minimal stream shim so styled-exceljs doesn't crash on
          // `require('stream')` in the browser Worker environment.
          const shimDir = path.join(root, "node_modules", ".vite", "shims");
          if (!fs.existsSync(shimDir)) fs.mkdirSync(shimDir, { recursive: true });
          const streamShim = path.join(shimDir, "stream-shim.js");
          fs.writeFileSync(streamShim, [
            "// Minimal stream shim for browser Worker environment",
            "export class Readable { constructor() {} pipe() { return this; } on() { return this; } destroy() {} }",
            "export class Writable { constructor() {} write() { return true; } end() {} on() { return this; } destroy() {} }",
            "export class Transform { constructor() {} pipe() { return this; } on() { return this; } write() { return true; } end() {} destroy() {} }",
            "export class PassThrough { constructor() {} pipe() { return this; } on() { return this; } write() { return true; } end() {} destroy() {} }",
            "export default { Readable, Writable, Transform, PassThrough };",
          ].join("\n"));
          try {
            buildSync({
              entryPoints: [workerEntry],
              bundle: true,
              format: "esm",
              outfile: outFile,
              platform: "browser",
              logLevel: "silent",
              alias: {
                stream: streamShim,
              },
              define: {
                "process.env.NODE_ENV": JSON.stringify("production"),
                "process.browser": "true",
                "global": "self",
              },
            });
          } catch (e) {
            console.warn("[vite] spreadsheet worker bundle failed:", e?.message);
          }
        },
      },
      {
        // Patch @file-viewer/pptx chart.js: billboard.js falls back to
        // appending a new <div class="bb"> to document.body when the
        // `bindto` selector (#chartID) doesn't match any element in the DOM.
        // This happens because PPT slides use lazy loading — the chart
        // placeholder isn't in the DOM yet when renderPptxPostProcessing runs.
        // Guard bb.generate() so charts are only rendered when their
        // placeholder element already exists.
        name: "fix-pptx-chart-bindto",
        enforce: "pre",
        buildStart() {
          const fs = require("fs");
          const path = require("path");
          const chartPath = path.join(
            process.cwd(),
            "../../node_modules/.pnpm/@file-viewer+renderer-presentation@2.1.27/node_modules/@file-viewer/pptx/dist/chart.js",
          );
          if (!fs.existsSync(chartPath)) return;
          let code = fs.readFileSync(chartPath, "utf-8");
          const target = "bb.generate(chart);";
          const replacement =
            "if (document.querySelector(chart.bindto)) { bb.generate(chart); }";
          if (!code.includes(replacement) && code.includes(target)) {
            code = code.replace(target, replacement);
            fs.writeFileSync(chartPath, code, "utf-8");
          }
        },
      },
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
        // fleet 经 /fleet/api 段挂载 (fleet api.go A.1: `fleet/api` segment 由
        // nginx 添加并 strip 转 fleet /v1)。一条规则覆盖所有 fleet 端点,
        // 无需逐个路径列举。必须在 /api/ catch-all 之前 (vite first-match)。
        // Note: bot feed (/bots/:uid/feed) 由 matter 直供 (上面 /matter/api/v1);
        // daemon 客户端直连 OCTO_FLEET_URL + /v1/...，不经此代理。
        "/fleet/api/": {
          target: env.VITE_FLEET_API_URL || "http://127.0.0.1:8092",
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(/^\/fleet\/api/, ''),
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
      include: [
        "@xmldom/xmldom",
        "styled-exceljs",
        "jszip",
      ],
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
