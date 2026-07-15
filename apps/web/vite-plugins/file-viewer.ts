import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

type Esbuild = typeof import("esbuild");

const packageRoot = (packageName: string, root: string) =>
  dirname(require.resolve(`${packageName}/package.json`, { paths: [root] }));

const viteCache = (root: string) => {
  const dir = join(root, "node_modules", ".vite");
  mkdirSync(dir, { recursive: true });
  return dir;
};

const bundleBrowserModule = (
  buildSync: Esbuild["buildSync"],
  entryPoint: string,
  outfile: string,
  streamShim: string,
) => {
  buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    outfile,
    platform: "browser",
    logLevel: "silent",
    alias: { stream: streamShim },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.browser": "true",
      global: "self",
    },
  });
};

export const fixXmldomCjs = (): Plugin => ({
  name: "fix-xmldom-cjs",
  enforce: "pre",
  buildStart() {
    const { buildSync } = require("esbuild") as Esbuild;
    const root = process.cwd();
    const outFile = join(viteCache(root), "xmldom-esm.js");
    const xmldomPath = require.resolve("@xmldom/xmldom", { paths: [root] });
    buildSync({ entryPoints: [xmldomPath], bundle: true, format: "esm", outfile: outFile, logLevel: "silent" });
    const code = readFileSync(outFile, "utf8");
    const marker = "export default require_index();";
    const index = code.lastIndexOf(marker);
    if (index < 0) {
      throw new Error("[vite] @xmldom/xmldom CJS export shape changed; named export patch cannot be applied");
    }
    const named = `var __xmldom = require_index();
export default __xmldom;
export const DOMParser = __xmldom.DOMParser;
export const XMLSerializer = __xmldom.XMLSerializer;
export const DOMImplementation = __xmldom.DOMImplementation;
export const DOMException = __xmldom.DOMException;
export const Node = __xmldom.Node;
export const Element = __xmldom.Element;
export const Document = __xmldom.Document;
export const Attr = __xmldom.Attr;
export const Text = __xmldom.Text;
export const Comment = __xmldom.Comment;
export const MIME_TYPE = __xmldom.MIME_TYPE;
export const NAMESPACE = __xmldom.NAMESPACE;
`;
    writeFileSync(outFile, code.slice(0, index) + named, "utf8");
  },
  resolveId(id) {
    if (id === "@xmldom/xmldom" || (id.includes("@xmldom/xmldom/lib/index") && !id.includes("?"))) {
      return join(process.cwd(), "node_modules", ".vite", "xmldom-esm.js");
    }
  },
});

export const bundleSpreadsheetAssets = (): Plugin => ({
  name: "bundle-spreadsheet-assets",
  enforce: "pre",
  buildStart() {
    const { buildSync } = require("esbuild") as Esbuild;
    const root = process.cwd();
    const spreadsheetRoot = packageRoot("@file-viewer/renderer-spreadsheet", root);
    const cache = viteCache(root);
    const shimDir = join(cache, "shims");
    mkdirSync(shimDir, { recursive: true });
    const streamShim = join(shimDir, "stream-shim.js");
    writeFileSync(streamShim, `export class Readable { constructor() {} pipe() { return this; } on() { return this; } destroy() {} }
export class Writable { constructor() {} write() { return true; } end() {} on() { return this; } destroy() {} }
export class Transform { constructor() {} pipe() { return this; } on() { return this; } write() { return true; } end() {} destroy() {} }
export class PassThrough { constructor() {} pipe() { return this; } on() { return this; } write() { return true; } end() {} destroy() {} }
export default { Readable, Writable, Transform, PassThrough };
`, "utf8");
    const publicDir = join(root, "public", "vendor", "xlsx");
    mkdirSync(publicDir, { recursive: true });
    const workerEntry = join(spreadsheetRoot, "dist", "spreadsheet", "worker", "sheetjs", "sheet.worker.js");
    const parserEntry = join(spreadsheetRoot, "dist", "spreadsheet", "worker", "sheetjs", "parser.js");
    if (!existsSync(workerEntry) || !existsSync(parserEntry)) {
      throw new Error("[vite] spreadsheet renderer worker/parser entry is missing");
    }
    bundleBrowserModule(buildSync, workerEntry, join(publicDir, "sheet.worker.js"), streamShim);
    bundleBrowserModule(buildSync, parserEntry, join(cache, "spreadsheet-parser.js"), streamShim);
  },
  transform(code, id) {
    if (!id.includes("@file-viewer+renderer-spreadsheet@") || !id.endsWith("/dist/spreadsheet.js")) return;
    const patched = code.replace(
      /import\((['"])(?:\.\/)?spreadsheet\/worker\/sheetjs\/parser\.js\1\)/g,
      'import("/node_modules/.vite/spreadsheet-parser.js")',
    );
    if (patched === code) throw new Error("[vite] spreadsheet parser dynamic import was not found");
    return { code: patched, map: null };
  },
});

export const patchSpreadsheetView = (): Plugin => ({
  name: "patch-spreadsheet-view",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("@file-viewer+renderer-spreadsheet@") || !id.endsWith("/dist/spreadsheet/view.js")) return;
    const patched = code.replace(
      /widthFillDisable: true,\s*renderType: 'both'/,
      "widthFillDisable: false,\n            renderType: 'both'",
    );
    if (patched === code) throw new Error("[vite] spreadsheet column width patch target was not found");
    return { code: patched, map: null };
  },
});

export const patchPptxChartBindto = (): Plugin => ({
  name: "patch-pptx-chart-bindto",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("@file-viewer+pptx@") || !id.endsWith("/dist/chart.js")) return;
    const target = "bb.generate(chart);";
    const replacement = "if (document.querySelector(chart.bindto)) { bb.generate(chart); }";
    if (code.includes(replacement)) return;
    if (!code.includes(target)) throw new Error("[vite] PPTX chart bindto patch target was not found");
    return { code: code.replace(target, replacement), map: null };
  },
});
