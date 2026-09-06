#!/usr/bin/env node
/**
 * Pseudo-localization generator.
 *
 *   pnpm i18n:pseudo         # generate <namespace>/en-XA.json from every en-US.json
 *   pnpm i18n:pseudo:check   # regenerate to memory and fail if the on-disk file drifted
 *
 * en-XA is the industry pseudo-locale (W3C / Chrome / Android). See
 * scripts/lib/i18n-pseudo.mjs for the transform rules and rationale.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { transformResource } from "./i18n/pseudo.mjs";

const root = process.cwd();
const sourceRoots = ["apps/web/src", "packages"];
const SOURCE_LOCALE = "en-US";
const PSEUDO_LOCALE = "en-XA";
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", ".turbo", ".next", "coverage"]);

async function walkForSourceLocaleFiles(dir) {
  const results = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkForSourceLocaleFiles(fullPath));
      continue;
    }
    if (entry.name !== `${SOURCE_LOCALE}.json`) continue;
    if (!fullPath.split(path.sep).includes("i18n")) continue;
    results.push(fullPath);
  }
  return results;
}

function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

async function collectSources() {
  const files = [];
  for (const sourceRoot of sourceRoots) {
    files.push(...await walkForSourceLocaleFiles(path.join(root, sourceRoot)));
  }
  return files.sort();
}

async function pseudoForSource(sourcePath) {
  const raw = await fs.readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  const pseudo = transformResource(parsed);
  const outputPath = path.join(path.dirname(sourcePath), `${PSEUDO_LOCALE}.json`);
  return { sourcePath, outputPath, serialized: serialize(pseudo) };
}

async function generate() {
  const sources = await collectSources();
  if (sources.length === 0) {
    console.log(`No ${SOURCE_LOCALE}.json files found under ${sourceRoots.join(", ")}.`);
    return;
  }
  for (const source of sources) {
    const { outputPath, serialized } = await pseudoForSource(source);
    await fs.writeFile(outputPath, serialized, "utf8");
    console.log(`wrote ${path.relative(root, outputPath)}`);
  }
  console.log(`i18n pseudo generated: ${sources.length} locale file(s).`);
}

async function check() {
  const sources = await collectSources();
  const drift = [];
  const missing = [];
  for (const source of sources) {
    const { outputPath, serialized } = await pseudoForSource(source);
    let existing;
    try {
      existing = await fs.readFile(outputPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push(path.relative(root, outputPath));
        continue;
      }
      throw error;
    }
    if (existing !== serialized) {
      drift.push(path.relative(root, outputPath));
    }
  }
  if (missing.length === 0 && drift.length === 0) {
    console.log(`i18n pseudo up to date: ${sources.length} locale file(s) match generator output.`);
    return;
  }
  if (missing.length > 0) {
    console.error(`Missing ${PSEUDO_LOCALE}.json (run 'pnpm i18n:pseudo'):`);
    for (const item of missing) console.error(`- ${item}`);
  }
  if (drift.length > 0) {
    console.error(`${PSEUDO_LOCALE}.json out of sync with ${SOURCE_LOCALE}.json (run 'pnpm i18n:pseudo'):`);
    for (const item of drift) console.error(`- ${item}`);
  }
  process.exit(1);
}

async function main() {
  const command = process.argv[2] || "generate";
  if (command === "generate") return generate();
  if (command === "check") return check();
  console.error(`Unknown command: ${command}. Use 'generate' or 'check'.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
