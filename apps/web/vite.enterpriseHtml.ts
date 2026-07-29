import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const ENTERPRISE_MODULES_ID = "virtual:octo-enterprise-modules";
const RESOLVED_ENTERPRISE_MODULES_ID = "\0virtual:octo-enterprise-modules";

export function readEnterpriseHtmlHead(headPath: string | undefined, rootDir: string): string {
  if (!headPath) return "";
  const resolved = path.isAbsolute(headPath) ? headPath : path.resolve(rootDir, headPath);
  return fs.readFileSync(resolved, "utf-8");
}

export function enterpriseHtmlHeadPlugin(headHtml: string): Plugin {
  return {
    name: "inject-enterprise-html-head",
    transformIndexHtml(html) {
      const trimmed = headHtml.trim();
      if (!trimmed) return html;
      return html.replace(/<\/head>/i, `${trimmed}\n  </head>`);
    },
  };
}

function resolveEnterpriseEntry(entryPath: string, rootDir: string): string {
  if (!entryPath.startsWith(".") && !path.isAbsolute(entryPath)) return entryPath;

  const resolved = path.isAbsolute(entryPath) ? entryPath : path.resolve(rootDir, entryPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[vite] VITE_ENTERPRISE_MODULES_ENTRY does not exist: ${resolved}`);
  }
  return resolved;
}

function resolveEnterpriseEntries(entryPaths: string | undefined, rootDir: string): string[] {
  if (!entryPaths) return [];
  return entryPaths
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolveEnterpriseEntry(item, rootDir));
}

function createEnterpriseModulesVirtualModule(entries: string[]): string {
  if (entries.length === 0) {
    return [
      "export function registerEnterpriseModules(_context) {}",
      "export function getEnterpriseStandaloneHandlers() { return [] }",
    ].join("\n");
  }

  const imports = entries.map((entry, index) => `import * as entry${index} from ${JSON.stringify(entry)};`);
  const refs = entries.map((_, index) => `entry${index}`);
  const registerCalls = refs.map((ref) => `  callEnterpriseExport(${ref}, "registerEnterpriseModules", [context]);`);
  const standaloneHandlerCalls = refs.map((ref) => `  appendEnterpriseHandlers(handlers, ${ref});`);

  return [
    ...imports,
    "",
    "function callEnterpriseExport(entry, exportName, args = []) {",
    "  const fn = entry[exportName];",
    "  return typeof fn === \"function\" ? fn(...args) : null;",
    "}",
    "function appendEnterpriseHandlers(handlers, entry) {",
    "  const value = callEnterpriseExport(entry, \"getEnterpriseStandaloneHandlers\");",
    "  if (Array.isArray(value)) handlers.push(...value);",
    "}",
    "",
    "export function registerEnterpriseModules(context) {",
    ...registerCalls,
    "}",
    "",
    "export function getEnterpriseStandaloneHandlers() {",
    "  const handlers = [];",
    ...standaloneHandlerCalls,
    "  return handlers;",
    "}",
  ].join("\n");
}

export function parseEnterpriseFsAllow(allowPaths: string | undefined, rootDir: string): string[] {
  if (!allowPaths) return [];
  return allowPaths
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (path.isAbsolute(item) ? item : path.resolve(rootDir, item)));
}

export function enterpriseModulesPlugin(
  entryPath: string | undefined,
  rootDir: string,
  extraFsAllow: string[] = []
): Plugin {
  const entries = resolveEnterpriseEntries(entryPath, rootDir);
  const entryDirs = entries
    .filter((entry) => path.isAbsolute(entry))
    .map((entry) => path.dirname(entry));
  const virtualModule = createEnterpriseModulesVirtualModule(entries);

  return {
    name: "enterprise-modules-slot",
    enforce: "pre",
    config() {
      if (entryDirs.length === 0 && extraFsAllow.length === 0) return undefined;
      const allow = Array.from(new Set([rootDir, ...entryDirs, ...extraFsAllow]));
      return {
        server: {
          fs: {
            allow,
          },
        },
      };
    },
    resolveId(id) {
      if (id !== ENTERPRISE_MODULES_ID) return undefined;
      return RESOLVED_ENTERPRISE_MODULES_ID;
    },
    load(id) {
      if (id !== RESOLVED_ENTERPRISE_MODULES_ID) return undefined;
      return virtualModule;
    },
  };
}
