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

  it("treats enterprise head HTML as a literal replacement", () => {
    const plugin = enterpriseHtmlHeadPlugin("<script>window.__ENT__ = \"a$&b$'c\"</script>");
    const transform = plugin.transformIndexHtml as (html: string) => string;

    expect(transform("<html><head></head><body></body></html>")).toBe(
      "<html><head><script>window.__ENT__ = \"a$&b$'c\"</script>\n  </head><body></body></html>",
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

  it("reports a clear error when the configured head path does not exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-html-"));
    const file = path.join(dir, "missing.html");

    expect(() => readEnterpriseHtmlHead(file, process.cwd())).toThrow(
      `[vite] VITE_ENTERPRISE_HTML_HEAD_PATH does not exist: ${file}`,
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
    fs.writeFileSync(
      file,
      [
        "export function registerEnterpriseModules() {}",
        "export function getEnterpriseStandaloneHandlers() { return [] }",
      ].join("\n"),
      "utf-8",
    );

    const plugin = enterpriseModulesPlugin(file, process.cwd());
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    const resolved = resolveId("virtual:octo-enterprise-modules");
    const source = load(resolved!);

    expect(resolved).toBe("\0virtual:octo-enterprise-modules");
    expect(source).toContain(`registerEnterpriseModules as registerEnterpriseModules0`);
    expect(source).toContain(`getEnterpriseStandaloneHandlers as getEnterpriseStandaloneHandlers0`);
    expect(source).toContain(`} from ${JSON.stringify(file)};`);
    expect(source).toContain("registerEnterpriseModules0(context);");
    expect(source).toContain("const entryHandlers0 = getEnterpriseStandaloneHandlers0();");
    expect(source).toContain("handlers.push(...entryHandlers0);");
  });

  it("can compose multiple enterprise entries without importing unconfigured modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-modules-"));
    const loopEntry = path.join(dir, "loop.ts");
    const personalEntry = path.join(dir, "personal.ts");
    fs.writeFileSync(loopEntry, "export function registerEnterpriseModules() {}\nexport function getEnterpriseStandaloneHandlers() { return [] }", "utf-8");
    fs.writeFileSync(personalEntry, "export function registerEnterpriseModules() {}\nexport function getEnterpriseStandaloneHandlers() { return [] }", "utf-8");

    const plugin = enterpriseModulesPlugin(
      [loopEntry, personalEntry].join(path.delimiter),
      process.cwd(),
    );
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    const source = load(resolveId("virtual:octo-enterprise-modules")!);

    expect(source).toContain(`} from ${JSON.stringify(loopEntry)};`);
    expect(source).toContain(`} from ${JSON.stringify(personalEntry)};`);
    expect(source).toContain("registerEnterpriseModules0(context);");
    expect(source).toContain("registerEnterpriseModules1(context);");
    expect(source).toContain("const entryHandlers0 = getEnterpriseStandaloneHandlers0();");
    expect(source).toContain("const entryHandlers1 = getEnterpriseStandaloneHandlers1();");
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

  it("keeps the monorepo workspace root allowed during enterprise dev", () => {
    const entryDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-entry-"));
    const entry = path.join(entryDir, "index.ts");
    fs.writeFileSync(entry, "export const marker = true", "utf-8");

    const plugin = enterpriseModulesPlugin(entry, process.cwd());
    const config = plugin.config?.({}, { command: "serve", mode: "development" });

    expect(config).toMatchObject({
      server: {
        fs: {
          allow: [path.resolve(process.cwd(), "../.."), entryDir],
        },
      },
    });
  });

  it("resolves repo-relative entry paths consistently with head paths", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-enterprise-root-"));
    const entryDir = path.join(rootDir, "enterprise");
    const entry = path.join(entryDir, "loop.ts");
    fs.mkdirSync(entryDir);
    fs.writeFileSync(entry, "export function registerEnterpriseModules() {}\nexport function getEnterpriseStandaloneHandlers() { return [] }", "utf-8");

    const plugin = enterpriseModulesPlugin("enterprise/loop.ts", rootDir);
    const load = plugin.load as (id: string) => string | undefined;
    const resolveId = plugin.resolveId as (id: string) => string | undefined;

    expect(load(resolveId("virtual:octo-enterprise-modules")!)).toContain(
      `} from ${JSON.stringify(entry)};`,
    );
  });
});
