import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enterpriseHtmlHeadPlugin,
  enterpriseModulesPlugin,
  parseEnterpriseFsAllow,
  readEnterpriseHtmlHead,
} from "../../vite.enterpriseHtml";

describe("enterprise HTML head injection", () => {
  it("injects enterprise head HTML before </head>", () => {
    const plugin = enterpriseHtmlHeadPlugin("<script>window.__ENTERPRISE__ = true</script>");
    const transform = plugin.transformIndexHtml as (html: string) => string;

    expect(transform("<html><head><meta charset=\"utf-8\" /></head><body></body></html>")).toBe(
      "<html><head><meta charset=\"utf-8\" /><script>window.__ENTERPRISE__ = true</script>\n  </head><body></body></html>",
    );
  });

  it("is a no-op when no enterprise head HTML is configured", () => {
    const plugin = enterpriseHtmlHeadPlugin("");
    const transform = plugin.transformIndexHtml as (html: string) => string;

    expect(transform("<html><head></head><body></body></html>")).toBe(
      "<html><head></head><body></body></html>",
    );
  });

  it("reads enterprise head HTML from a configured path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-html-"));
    const file = path.join(dir, "head.html");
    fs.writeFileSync(file, "<script>window.__ENTERPRISE_HEAD__ = true</script>", "utf-8");

    expect(readEnterpriseHtmlHead(file, process.cwd())).toBe(
      "<script>window.__ENTERPRISE_HEAD__ = true</script>",
    );
  });
});

describe("enterprise modules slot", () => {
  it("defaults to an open-source no-op virtual module", () => {
    const plugin = enterpriseModulesPlugin(undefined, process.cwd());
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    const resolved = resolveId("virtual:octo-enterprise-modules");
    expect(resolved).toBe("\0virtual:octo-enterprise-modules");
    expect(load(resolved!)).toContain("registerEnterpriseModules");
    expect(load(resolved!)).toContain("getEnterpriseStandaloneHandlers() { return [] }");
  });

  it("can synthesize the virtual module from one configured entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-modules-"));
    const file = path.join(dir, "loop.ts");
    fs.writeFileSync(file, "export function registerEnterpriseModules() {}", "utf-8");

    const plugin = enterpriseModulesPlugin(file, process.cwd());
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    const resolved = resolveId("virtual:octo-enterprise-modules");
    const source = load(resolved!);

    expect(resolved).toBe("\0virtual:octo-enterprise-modules");
    expect(source).toContain(`import * as entry0 from ${JSON.stringify(file)};`);
    expect(source).toContain("callEnterpriseExport(entry0, \"registerEnterpriseModules\", [context]);");
    expect(source).toContain("appendEnterpriseHandlers(handlers, entry0);");
    expect(source).toContain("callEnterpriseExport(entry, \"getEnterpriseStandaloneHandlers\")");
  });

  it("can compose multiple enterprise entries without importing unconfigured modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-modules-"));
    const loopEntry = path.join(dir, "loop.ts");
    const personalEntry = path.join(dir, "personal.ts");
    fs.writeFileSync(loopEntry, "export function registerEnterpriseModules() {}", "utf-8");
    fs.writeFileSync(personalEntry, "export function registerEnterpriseModules() {}", "utf-8");

    const plugin = enterpriseModulesPlugin(
      [loopEntry, personalEntry].join(path.delimiter),
      process.cwd(),
    );
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    const source = load(resolveId("virtual:octo-enterprise-modules")!);

    expect(source).toContain(`import * as entry0 from ${JSON.stringify(loopEntry)};`);
    expect(source).toContain(`import * as entry1 from ${JSON.stringify(personalEntry)};`);
    expect(source).toContain("callEnterpriseExport(entry0, \"registerEnterpriseModules\", [context]);");
    expect(source).toContain("callEnterpriseExport(entry1, \"registerEnterpriseModules\", [context]);");
    expect(source).toContain("appendEnterpriseHandlers(handlers, entry0);");
    expect(source).toContain("appendEnterpriseHandlers(handlers, entry1);");
    expect(source).toContain("return handlers;");
  });

  it("keeps enterprise filesystem allow paths explicit", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-root-"));
    const entryDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-entry-"));
    const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-loop-module-"));
    const nodeModulesDir = path.join(rootDir, "node_modules");
    const entry = path.join(entryDir, "index.ts");
    fs.writeFileSync(entry, "export const marker = true", "utf-8");

    const extraAllow = parseEnterpriseFsAllow(
      [loopDir, "node_modules"].join(path.delimiter),
      rootDir,
    );
    const plugin = enterpriseModulesPlugin(entry, rootDir, extraAllow);
    const config = plugin.config?.({}, { command: "serve", mode: "development" });

    expect(config).toMatchObject({
      server: {
        fs: {
          allow: [rootDir, entryDir, loopDir, nodeModulesDir],
        },
      },
    });
  });
});
