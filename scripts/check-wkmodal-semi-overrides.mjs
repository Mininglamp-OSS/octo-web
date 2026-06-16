#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoots = ["apps", "packages"];
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const styleExtensions = new Set([".css", ".less", ".scss"]);
const wkModalInternalStyleFile = path.join(
  "packages",
  "dmworkbase",
  "src",
  "Components",
  "WKModal",
  "index.css",
);
const ignoredDirs = new Set([
  ".git",
  ".turbo",
  ".output",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.endsWith(path.join("public", "pdfjs"))) continue;
      walk(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function getLineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findOpeningTags(text, tagName) {
  const tags = [];
  const needle = `<${tagName}`;
  let index = 0;

  while ((index = text.indexOf(needle, index)) !== -1) {
    let cursor = index + needle.length;
    let quote = "";
    let braceDepth = 0;

    for (; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      const prev = text[cursor - 1];

      if (quote) {
        if (char === quote && prev !== "\\") quote = "";
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "{") {
        braceDepth += 1;
        continue;
      }

      if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }

      if (char === ">" && braceDepth === 0) {
        tags.push({
          index,
          text: text.slice(index, cursor + 1),
        });
        cursor += 1;
        break;
      }
    }

    index = cursor;
  }

  return tags;
}

function extractWKModalClasses(files) {
  const classNames = new Set(["wk-modal"]);

  for (const file of files) {
    if (!sourceExtensions.has(path.extname(file))) continue;

    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("<WKModal")) continue;

    for (const tag of findOpeningTags(text, "WKModal")) {
      const match = tag.text.match(
        /\bclassName\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*"([^"]+)"\s*\}|\{\s*'([^']+)'\s*\})/,
      );
      if (!match) continue;

      const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      for (const className of value.split(/\s+/).filter(Boolean)) {
        classNames.add(className);
      }
    }
  }

  return classNames;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    "\n".repeat(comment.split("\n").length - 1),
  );
}

function classTokenRegex(className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])`);
}

function scanCss(files, wkModalClasses) {
  const violations = [];
  const nativeSemiOverrides = [];
  const classRegexes = [...wkModalClasses].map((className) => ({
    className,
    regex: classTokenRegex(className),
  }));

  for (const file of files) {
    if (!styleExtensions.has(path.extname(file))) continue;
    if (path.relative(repoRoot, file) === wkModalInternalStyleFile) continue;

    const rawText = fs.readFileSync(file, "utf8");
    if (!rawText.includes(".semi-modal")) continue;

    const text = stripCssComments(rawText);
    const ruleRegex = /([^{}]+)\{/g;
    let match;

    while ((match = ruleRegex.exec(text)) !== null) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      if (!selector.includes(".semi-modal")) continue;

      const matchedClasses = classRegexes
        .filter(({ regex }) => regex.test(selector))
        .map(({ className }) => className);

      const entry = {
        file,
        line: getLineNumber(text, match.index),
        selector: selector.replace(/\s+/g, " "),
      };

      if (matchedClasses.length > 0) {
        violations.push({
          ...entry,
          classes: matchedClasses,
        });
      } else {
        nativeSemiOverrides.push(entry);
      }
    }
  }

  return { violations, nativeSemiOverrides };
}

const files = sourceRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const wkModalClasses = extractWKModalClasses(files);
const { violations, nativeSemiOverrides } = scanCss(files, wkModalClasses);

if (violations.length > 0) {
  console.error(
    "WKModal callers must not override Semi Modal internals. Target .wk-modal-shell/.wk-modal-body instead.",
  );
  for (const violation of violations) {
    const relativeFile = path.relative(repoRoot, violation.file);
    console.error(
      `- ${relativeFile}:${violation.line} (${violation.classes.join(", ")}): ${violation.selector}`,
    );
  }
  process.exit(1);
}

console.log(
  `WKModal Semi override check passed (${wkModalClasses.size} WKModal class names scanned).`,
);

if (nativeSemiOverrides.length > 0) {
  console.log(
    `Found ${nativeSemiOverrides.length} native Semi Modal override(s) outside WKModal callers; left as existing technical debt.`,
  );
}
