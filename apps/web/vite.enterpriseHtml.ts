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

function resolveEnterpriseEntry(entryPath: string | undefined, rootDir: string): string | null {
  if (!entryPath) return null;
  if (!entryPath.startsWith(".") && !path.isAbsolute(entryPath)) return entryPath;

  const resolved = path.isAbsolute(entryPath) ? entryPath : path.resolve(rootDir, entryPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[vite] VITE_ENTERPRISE_MODULES_ENTRY does not exist: ${resolved}`);
  }
  return resolved;
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
  const entry = resolveEnterpriseEntry(entryPath, rootDir);
  const entryDir = entry && path.isAbsolute(entry) ? path.dirname(entry) : null;

  return {
    name: "enterprise-modules-slot",
    enforce: "pre",
    config() {
      if (!entryDir && extraFsAllow.length === 0) return undefined;
      const allow = Array.from(new Set([rootDir, ...(entryDir ? [entryDir] : []), ...extraFsAllow]));
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
      return entry || RESOLVED_ENTERPRISE_MODULES_ID;
    },
    load(id) {
      if (id !== RESOLVED_ENTERPRISE_MODULES_ID) return undefined;
      return [
        "export function registerEnterpriseModules(_context) {}",
        "export function getEnterpriseStandaloneDocCapability() { return null }",
      ].join("\n");
    },
  };
}
