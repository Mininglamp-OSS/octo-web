#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const reportDir = path.join(root, ".i18n", "reports");
const baselinePath = path.join(root, ".i18n", "hardcoded-strings-baseline.json");
const scanConfigPath = path.join(root, ".i18n", "scan-config.json");
const sourceRoots = ["apps/web/src", "packages"];
const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/;
const sourceExts = new Set([".ts", ".tsx"]);
const supportedLocales = ["zh-CN", "en-US"];
let scanConfig = { ignoredFiles: [] };

const namespaceByDir = {
  dmworkappbot: "appbot",
  dmworkbase: "base",
  dmworkcontacts: "contacts",
  dmworkdatasource: "datasource",
  dmworklogin: "login",
  dmworksummary: "summary",
  dmworktodo: "todo",
};

const knownNamespaces = new Set(["app", ...Object.values(namespaceByDir)]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function hasCjk(value) {
  return cjkPattern.test(value);
}

function isTranslationKey(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z][A-Za-z0-9_.-]*\.[A-Za-z0-9_.-]+$/.test(value)) return false;
  const namespace = value.split(".")[0];
  return knownNamespaces.has(namespace);
}

function isTranslationCall(expression) {
  const callName = getCallName(expression);
  return callName === "t" || callName === "translate" || callName.endsWith(".t");
}

function shouldSkipFile(relPath) {
  const normalized = toPosix(relPath);
  const ignoredFileSet = new Set(
    (scanConfig.ignoredFiles || []).map((entry) => typeof entry === "string" ? entry : entry.path),
  );
  return (
    ignoredFileSet.has(normalized) ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/i18n/") ||
    normalized.includes("/public/") ||
    normalized.endsWith(".stories.tsx") ||
    normalized.endsWith(".stories.ts") ||
    normalized.endsWith(".story.tsx") ||
    normalized.endsWith(".story.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.ts")
  );
}

async function loadScanConfig() {
  try {
    scanConfig = JSON.parse(await fs.readFile(scanConfigPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    scanConfig = { ignoredFiles: [] };
  }
}

async function walk(dir) {
  const results = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walk(fullPath));
      continue;
    }
    if (!sourceExts.has(path.extname(entry.name))) continue;
    const relPath = toPosix(path.relative(root, fullPath));
    if (shouldSkipFile(relPath)) continue;
    results.push(fullPath);
  }
  return results;
}

async function walkLocaleFiles(dir) {
  const results = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkLocaleFiles(fullPath));
      continue;
    }
    if (!supportedLocales.some((locale) => entry.name === `${locale}.json`)) continue;
    const relPath = toPosix(path.relative(root, fullPath));
    if (!relPath.includes("/i18n/")) continue;
    results.push(fullPath);
  }
  return results;
}

function getPackageInfo(relPath) {
  if (relPath.startsWith("apps/web/src/")) {
    return { packageName: "apps/web", namespace: "app" };
  }
  const parts = relPath.split("/");
  if (parts[0] === "packages" && parts[1]) {
    return {
      packageName: `packages/${parts[1]}`,
      namespace: namespaceByDir[parts[1]] || parts[1].replace(/^dmwork/, ""),
    };
  }
  return { packageName: "unknown", namespace: "app" };
}

function slugFromPath(relPath) {
  const withoutSrc = relPath
    .replace(/^apps\/web\/src\//, "")
    .replace(/^packages\/[^/]+\/src\//, "")
    .replace(/\.(tsx|ts)$/, "");
  return withoutSrc
    .split("/")
    .filter(Boolean)
    .slice(-3)
    .join(".")
    .replace(/[^a-zA-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase() || "copy";
}

function getCallName(node) {
  if (!node) return "";
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${getCallName(node.expression)}.${node.name.text}`;
  return node.getText();
}

function classifyStringLiteral(node) {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return undefined;
  }
  if (ts.isJsxAttribute(parent)) return { kind: "jsx-attribute", confidence: "safe" };
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    return {
      kind: "call-argument",
      confidence: /Toast|Modal|Notification|alert|Menus/.test(getCallName(parent.expression))
        ? "review"
        : "manual",
    };
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return { kind: "object-property", confidence: "review" };
  }
  return { kind: "string-literal", confidence: "manual" };
}

function candidateFor(sourceFile, relPath, node, text, kind, confidence, reason) {
  const normalizedText = normalizeText(text);
  if (!normalizedText || !hasCjk(normalizedText)) return undefined;

  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const { packageName, namespace } = getPackageInfo(relPath);
  const suggestedKey = `${namespace}.migration.${slugFromPath(relPath)}.${kind}.${position.line + 1}`;

  return {
    file: relPath,
    line: position.line + 1,
    column: position.character + 1,
    packageName,
    namespace,
    kind,
    text: normalizedText,
    suggestedKey,
    confidence,
    ...(reason ? { reason } : {}),
  };
}

function scanSource(fullPath, content) {
  const relPath = toPosix(path.relative(root, fullPath));
  const sourceFile = ts.createSourceFile(
    relPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates = [];

  function pushCandidate(node, text, kind, confidence, reason) {
    const candidate = candidateFor(sourceFile, relPath, node, text, kind, confidence, reason);
    if (candidate) candidates.push(candidate);
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      pushCandidate(node, node.getText(sourceFile), "jsx-text", "safe");
    } else if (ts.isStringLiteral(node)) {
      const classified = classifyStringLiteral(node);
      if (classified) {
        pushCandidate(node, node.text, classified.kind, classified.confidence);
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      pushCandidate(node, node.text, "template-literal", "manual", "template literal needs manual review");
    } else if (ts.isTemplateExpression(node)) {
      const text = [
        node.head.text,
        ...node.templateSpans.map((span) => `{{value}}${span.literal.text}`),
      ].join("");
      pushCandidate(node, text, "template-literal", "manual", "template literal needs interpolation design");
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

async function scan() {
  const files = [];
  for (const sourceRoot of sourceRoots) {
    files.push(...await walk(path.join(root, sourceRoot)));
  }

  const candidates = [];
  for (const file of files.sort()) {
    const content = await fs.readFile(file, "utf8");
    candidates.push(...scanSource(file, content));
  }

  return candidates.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.text.localeCompare(b.text)
  );
}

async function collectTranslationKeyUsages() {
  const files = [];
  for (const sourceRoot of sourceRoots) {
    files.push(...await walk(path.join(root, sourceRoot)));
  }

  const usages = [];
  for (const file of files.sort()) {
    const relPath = toPosix(path.relative(root, file));
    const content = await fs.readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        const isStaticTranslationArgument =
          ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          isTranslationCall(parent.expression);
        if (isStaticTranslationArgument && isTranslationKey(node.text)) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          usages.push({
            file: relPath,
            key: node.text,
            line: position.line + 1,
            column: position.character + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return usages.sort((a, b) =>
    a.key.localeCompare(b.key) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column
  );
}

function flattenMessages(messages, prefix = "", output = {}, issues = [], context = {}) {
  if (typeof messages === "string") {
    if (!prefix) {
      issues.push({
        type: "invalid-root-string",
        ...context,
      });
      return output;
    }
    output[prefix] = messages;
    return output;
  }

  if (!messages || typeof messages !== "object" || Array.isArray(messages)) {
    issues.push({
      type: "non-string-leaf",
      key: prefix || "(root)",
      valueType: Array.isArray(messages) ? "array" : typeof messages,
      ...context,
    });
    return output;
  }

  for (const [key, value] of Object.entries(messages)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    flattenMessages(value, nextKey, output, issues, context);
  }
  return output;
}

function interpolationTokens(value) {
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

function sameTokenSet(a, b) {
  if (a.length !== b.length) return false;
  return a.every((token, index) => token === b[index]);
}

function localeIssueSort(a, b) {
  return (
    (a.dir || "").localeCompare(b.dir || "") ||
    (a.key || "").localeCompare(b.key || "") ||
    (a.locale || "").localeCompare(b.locale || "") ||
    a.type.localeCompare(b.type)
  );
}

async function checkLocaleResources() {
  const localeFiles = [];
  for (const sourceRoot of sourceRoots) {
    localeFiles.push(...await walkLocaleFiles(path.join(root, sourceRoot)));
  }

  const resourceDirs = new Map();
  for (const file of localeFiles.sort()) {
    const relPath = toPosix(path.relative(root, file));
    const locale = supportedLocales.find((candidate) => relPath.endsWith(`/${candidate}.json`));
    if (!locale) continue;
    const dir = toPosix(path.dirname(relPath));
    if (!resourceDirs.has(dir)) resourceDirs.set(dir, {});
    resourceDirs.get(dir)[locale] = { file, relPath };
  }

  const issues = [];
  const resourceKeysByLocale = Object.fromEntries(supportedLocales.map((locale) => [locale, new Set()]));

  for (const [dir, filesByLocale] of [...resourceDirs.entries()].sort()) {
    const firstFile = Object.values(filesByLocale)[0];
    const { namespace, packageName } = getPackageInfo(firstFile.relPath);
    const entriesByLocale = {};

    for (const locale of supportedLocales) {
      const localeFile = filesByLocale[locale];
      if (!localeFile) {
        issues.push({
          type: "missing-locale-file",
          dir,
          locale,
          namespace,
          packageName,
        });
        continue;
      }

      try {
        const parsed = JSON.parse(await fs.readFile(localeFile.file, "utf8"));
        const localIssues = [];
        const entries = flattenMessages(parsed, "", {}, localIssues, {
          dir,
          file: localeFile.relPath,
          locale,
          namespace,
          packageName,
        });
        entriesByLocale[locale] = entries;
        for (const key of Object.keys(entries)) {
          resourceKeysByLocale[locale].add(key.startsWith(`${namespace}.`) ? key : `${namespace}.${key}`);
        }
        issues.push(...localIssues);
      } catch (error) {
        issues.push({
          type: "invalid-json",
          dir,
          file: localeFile.relPath,
          locale,
          namespace,
          packageName,
          message: error.message,
        });
      }
    }

    const allKeys = new Set(Object.values(entriesByLocale).flatMap((entries) => Object.keys(entries || {})));
    for (const key of [...allKeys].sort()) {
      for (const locale of supportedLocales) {
        if (!Object.prototype.hasOwnProperty.call(entriesByLocale[locale] || {}, key)) {
          issues.push({
            type: "missing-key",
            dir,
            key,
            locale,
            namespace,
            packageName,
          });
        }
      }

      const baseValue = entriesByLocale["zh-CN"]?.[key];
      if (baseValue === undefined) continue;
      const baseTokens = interpolationTokens(baseValue);
      for (const locale of supportedLocales.filter((candidate) => candidate !== "zh-CN")) {
        const value = entriesByLocale[locale]?.[key];
        if (value === undefined) continue;
        const tokens = interpolationTokens(value);
        if (!sameTokenSet(baseTokens, tokens)) {
          issues.push({
            type: "placeholder-mismatch",
            dir,
            key,
            locale,
            namespace,
            packageName,
            expected: baseTokens,
            actual: tokens,
          });
        }
      }
    }
  }

  const keyUsages = await collectTranslationKeyUsages();
  const uniqueUsageKeys = new Map();
  for (const usage of keyUsages) {
    if (!uniqueUsageKeys.has(usage.key)) uniqueUsageKeys.set(usage.key, []);
    uniqueUsageKeys.get(usage.key).push(usage);
  }

  for (const [key, usages] of uniqueUsageKeys) {
    for (const locale of supportedLocales) {
      if (!resourceKeysByLocale[locale].has(key)) {
        issues.push({
          type: "missing-used-key",
          key,
          locale,
          examples: usages.slice(0, 5),
        });
      }
    }
  }

  const sortedIssues = issues.sort(localeIssueSort);
  return {
    generatedAt: new Date().toISOString(),
    supportedLocales,
    checkedResourceDirs: resourceDirs.size,
    staticKeyUsageCount: keyUsages.length,
    uniqueStaticKeyUsageCount: uniqueUsageKeys.size,
    issueCount: sortedIssues.length,
    issues: sortedIssues,
  };
}

function summarize(candidates) {
  const byPackage = {};
  const byKind = {};
  const byConfidence = {};
  const byFile = {};

  for (const candidate of candidates) {
    byPackage[candidate.packageName] = (byPackage[candidate.packageName] || 0) + 1;
    byKind[candidate.kind] = (byKind[candidate.kind] || 0) + 1;
    byConfidence[candidate.confidence] = (byConfidence[candidate.confidence] || 0) + 1;
    byFile[candidate.file] = (byFile[candidate.file] || 0) + 1;
  }

  return { byConfidence, byFile, byKind, byPackage };
}

function signatureOf(candidate) {
  return `${candidate.file}\u0000${candidate.kind}\u0000${candidate.text}`;
}

function createBaseline(candidates) {
  const signatures = {};
  for (const candidate of candidates) {
    const signature = signatureOf(candidate);
    if (!signatures[signature]) {
      signatures[signature] = {
        count: 0,
        file: candidate.file,
        kind: candidate.kind,
        namespace: candidate.namespace,
        packageName: candidate.packageName,
        text: candidate.text,
      };
    }
    signatures[signature].count += 1;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    signatureCount: Object.keys(signatures).length,
    ignoredFiles: scanConfig.ignoredFiles || [],
    summary: summarize(candidates),
    signatures,
  };
}

async function writeReports(candidates) {
  await fs.mkdir(reportDir, { recursive: true });
  const summary = summarize(candidates);
  const jsonReport = {
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    ignoredFiles: scanConfig.ignoredFiles || [],
    summary,
    candidates,
  };
  await fs.writeFile(
    path.join(reportDir, "hardcoded-strings.json"),
    `${JSON.stringify(jsonReport, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(reportDir, "hardcoded-strings.md"),
    renderMarkdownReport(candidates, summary),
    "utf8",
  );
}

async function writeLocaleReports(localeReport) {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(
    path.join(reportDir, "locale-keys.json"),
    `${JSON.stringify(localeReport, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(reportDir, "locale-keys.md"),
    renderLocaleReport(localeReport),
    "utf8",
  );
}

function renderCountTable(record, headers) {
  const rows = Object.entries(record).sort((a, b) => b[1] - a[1]);
  return [
    `| ${headers[0]} | ${headers[1]} |`,
    "| --- | ---: |",
    ...rows.map(([key, value]) => `| \`${key}\` | ${value} |`),
  ].join("\n");
}

function renderMarkdownReport(candidates, summary) {
  const topFiles = Object.entries(summary.byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .reduce((acc, [file, count]) => {
      acc[file] = count;
      return acc;
    }, {});

  const sampleRows = candidates.slice(0, 200).map((candidate) => (
    `| \`${candidate.file}:${candidate.line}\` | ${candidate.kind} | ${candidate.confidence} | \`${candidate.suggestedKey}\` | ${candidate.text.replace(/\|/g, "\\|")} |`
  ));

  return `${[
    "# I18n Hardcoded String Scan",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `Total candidates: ${candidates.length}`,
    "",
    "## Ignored Files",
    "",
    ...(scanConfig.ignoredFiles?.length
      ? scanConfig.ignoredFiles.map((entry) => {
          const file = typeof entry === "string" ? entry : entry.path;
          const reason = typeof entry === "string" ? "" : entry.reason;
          return `- \`${file}\`${reason ? `: ${reason}` : ""}`;
        })
      : ["None."]),
    "",
    "## By Package",
    "",
    renderCountTable(summary.byPackage, ["Package", "Candidates"]),
    "",
    "## By Kind",
    "",
    renderCountTable(summary.byKind, ["Kind", "Candidates"]),
    "",
    "## By Confidence",
    "",
    renderCountTable(summary.byConfidence, ["Confidence", "Candidates"]),
    "",
    "## Top Files",
    "",
    renderCountTable(topFiles, ["File", "Candidates"]),
    "",
    "## Candidate Sample",
    "",
    "The JSON report contains the full candidate list. This table shows the first 200 candidates for quick review.",
    "",
    "| Location | Kind | Confidence | Suggested key | Text |",
    "| --- | --- | --- | --- | --- |",
    ...sampleRows,
    "",
  ].join("\n")}\n`;
}

function renderLocaleReport(report) {
  const rows = report.issues.slice(0, 200).map((issue) => {
    const location = issue.file || issue.dir || issue.examples?.[0]?.file || "";
    const key = issue.key || "";
    const details = issue.type === "placeholder-mismatch"
      ? `expected: ${issue.expected.join(", ") || "(none)"}; actual: ${issue.actual.join(", ") || "(none)"}`
      : issue.message || (issue.examples?.length
          ? issue.examples.map((example) => `${example.file}:${example.line}`).join(", ")
          : "");
    return `| ${issue.type} | ${issue.locale || ""} | \`${key}\` | \`${location}\` | ${details.replace(/\|/g, "\\|")} |`;
  });

  return `${[
    "# I18n Locale Key Check",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Supported locales: ${report.supportedLocales.map((locale) => `\`${locale}\``).join(", ")}`,
    "",
    `Checked resource directories: ${report.checkedResourceDirs}`,
    "",
    `Static key usages: ${report.staticKeyUsageCount} usages, ${report.uniqueStaticKeyUsageCount} unique keys`,
    "",
    `Total issues: ${report.issueCount}`,
    "",
    "| Type | Locale | Key | Location | Details |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    ...(report.issues.length > 200 ? [`| ... | ... | ... | ... | ${report.issues.length - 200} more issues in JSON report. |`] : []),
    "",
  ].join("\n")}\n`;
}

async function readBaseline() {
  try {
    return JSON.parse(await fs.readFile(baselinePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Missing .i18n/hardcoded-strings-baseline.json. Run `pnpm i18n:baseline` first.");
    }
    throw error;
  }
}

function checkAgainstBaseline(candidates, baseline) {
  const current = createBaseline(candidates);
  const newCandidates = [];

  for (const [signature, currentEntry] of Object.entries(current.signatures)) {
    const baselineEntry = baseline.signatures?.[signature];
    const baselineCount = baselineEntry?.count || 0;
    if (currentEntry.count > baselineCount) {
      newCandidates.push({
        ...currentEntry,
        newCount: currentEntry.count - baselineCount,
      });
    }
  }

  return newCandidates.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.kind.localeCompare(b.kind) ||
    a.text.localeCompare(b.text)
  );
}

async function main() {
  await loadScanConfig();
  const command = process.argv[2] || "scan";
  const candidates = await scan();
  const localeReport = await checkLocaleResources();
  await writeReports(candidates);
  await writeLocaleReports(localeReport);

  if (command === "baseline") {
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(
      baselinePath,
      `${JSON.stringify(createBaseline(candidates), null, 2)}\n`,
      "utf8",
    );
    console.log(`i18n baseline updated: ${candidates.length} candidates`);
    return;
  }

  if (command === "check") {
    const baseline = await readBaseline();
    const newCandidates = checkAgainstBaseline(candidates, baseline);
    if (newCandidates.length > 0 || localeReport.issueCount > 0) {
      if (localeReport.issueCount > 0) {
        console.error(`i18n locale check failed: ${localeReport.issueCount} locale key issues found.`);
        for (const issue of localeReport.issues.slice(0, 20)) {
          const location = issue.file || issue.dir || issue.examples?.[0]?.file || "";
          console.error(`- ${issue.type}: ${issue.locale || ""} ${issue.key || ""} ${location}`.trim());
        }
        if (localeReport.issueCount > 20) {
          console.error(`...and ${localeReport.issueCount - 20} more. See .i18n/reports/locale-keys.json.`);
        }
      }

      if (newCandidates.length > 0) {
        console.error(`i18n check failed: ${newCandidates.length} new hardcoded Chinese signatures found.`);
        for (const candidate of newCandidates.slice(0, 20)) {
          console.error(`- ${candidate.file}: ${candidate.text}`);
        }
        if (newCandidates.length > 20) {
          console.error(`...and ${newCandidates.length - 20} more. See .i18n/reports/hardcoded-strings.json.`);
        }
      }
      process.exit(1);
    }
    console.log(`i18n check passed: ${candidates.length} candidates within baseline; locale keys healthy`);
    return;
  }

  if (command !== "scan") {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  console.log(`i18n scan completed: ${candidates.length} candidates; ${localeReport.issueCount} locale key issues`);
  console.log("Reports written to .i18n/reports");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
