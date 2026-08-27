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
]);

const legacyPatterns = [
  { pattern: /\bWKModal\b/g, message: "uses legacy WKModal; use @octo/ui Modal" },
  { pattern: /\bwkConfirm\b/g, message: "uses legacy wkConfirm; use @octo/ui modalConfirm" },
  { pattern: /Components\/WKModal/g, message: "imports legacy Components/WKModal path" },
  { pattern: /\.wk-modal(?:\b|-)/g, message: "uses legacy .wk-modal selector; use .octo-ui-modal__* selectors" },
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

const violations = [];

for (const scanRoot of scanRoots) {
  const absRoot = join(root, scanRoot);
  for (const file of walk(absRoot)) {
    const rel = relative(root, file);
    const source = readFileSync(file, "utf8");

    for (const { pattern, message } of legacyPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} ${message}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Octo UI Modal usage check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Octo UI Modal usage check passed.");
