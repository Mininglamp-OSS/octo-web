#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = ["apps", "packages"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const styleExtensions = new Set([".css", ".less", ".scss"]);
const ignoredSegments = new Set([
  ".git",
  ".turbo",
  ".output",
  "build",
  "build-e2e",
  "coverage",
  "dist",
  "node_modules",
  "public",
]);

const legacyPatterns = [
  { pattern: /\bWKModal\b/g, message: "uses legacy WKModal; use @octo/ui Modal" },
  { pattern: /\bwkConfirm\b/g, message: "uses legacy wkConfirm; use @octo/ui modalConfirm" },
  { pattern: /Components\/WKModal/g, message: "imports legacy Components/WKModal path" },
  { pattern: /\.wk-modal(?:\b|-)/g, message: "uses legacy .wk-modal selector; use .octo-ui-modal__* selectors" },
];

const allowedLegacyFiles = new Set([
  // Public compatibility aliases for out-of-repo @octo/base consumers. New
  // internal call sites must still use @octo/ui directly.
  "packages/dmworkbase/src/index.tsx",
  "packages/dmworkbase/src/Components/WKCompatibility/index.tsx",
]);

const semiOverridePatterns = [
  "octo-ui-modal",
];

function extname(file) {
  const index = file.lastIndexOf(".");
  return index >= 0 ? file.slice(index) : "";
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredSegments.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }

    const ext = extname(entry);
    if (sourceExtensions.has(ext) || styleExtensions.has(ext)) files.push(full);
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function collectModalClassNames(source) {
  const names = new Set(["WKModal"]);
  const importPattern = /(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']@octo\/ui["']/g;
  let match;
  while ((match = importPattern.exec(source))) {
    for (const rawSpecifier of match[1].split(",").map((part) => part.trim().replace(/^type\s+/, ""))) {
      const parts = rawSpecifier.split(/\s+as\s+/);
      if (parts[0] === "Modal") names.add(parts[1] || "Modal");
    }
  }

  const tagPattern = new RegExp(`<(${Array.from(names).map(escapeRegExp).join("|")})\\b[^>]*>`, "g");
  const classes = [];
  while ((match = tagPattern.exec(source))) {
    const tag = match[0];
    const classMatch = /\bclassName\s*=\s*(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)/.exec(tag);
    if (!classMatch) continue;
    const classSource = classMatch[1] || classMatch[2] || classMatch[3] || "";
    for (const className of classSource.split(/\s+/).filter(Boolean)) {
      classes.push(className);
    }
  }
  return classes;
}

function selectorTouchesClass(selector, className) {
  return new RegExp(`\\.${escapeRegExp(className)}(?:\\b|[.#:[\\s>+~])`).test(selector);
}

function selectorTouchesSemiModal(selector) {
  return /\.semi-modal(?:\b|-)/.test(selector);
}

function collectSemiModalOverrideViolations(source, classNames) {
  const stripped = blankComments(source);
  const violations = [];
  const rulePattern = /([^{}]+)\{/g;
  let match;
  while ((match = rulePattern.exec(stripped))) {
    const selectors = match[1].split(",").map((selector) => selector.replace(/\s+/g, " ").trim());
    for (const selector of selectors) {
      if (!selectorTouchesSemiModal(selector)) continue;
      for (const className of classNames) {
        if (selectorTouchesClass(selector, className)) {
          violations.push(match.index);
          break;
        }
      }
    }
  }
  return violations;
}

const violations = [];
const files = [];
const modalClassNames = new Set(semiOverridePatterns);

for (const scanRoot of scanRoots) {
  const absRoot = join(root, scanRoot);
  files.push(...walk(absRoot));
}

for (const file of files) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  if (!allowedLegacyFiles.has(rel) && sourceExtensions.has(extname(file))) {
    for (const className of collectModalClassNames(source)) modalClassNames.add(className);
  }
}

for (const file of files) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");

  if (!allowedLegacyFiles.has(rel)) {
    for (const { pattern, message } of legacyPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} ${message}`);
      }
    }
  }

  if (styleExtensions.has(extname(file))) {
    for (const index of collectSemiModalOverrideViolations(source, modalClassNames)) {
      violations.push(`${rel}:${lineNumber(source, index)} overrides Semi Modal internals through Octo Modal; use octo-ui-modal__* selectors`);
    }
  }
}

if (violations.length > 0) {
  console.error("Octo UI Modal usage check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Octo UI Modal usage check passed.");
