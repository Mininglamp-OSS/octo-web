#!/usr/bin/env node
/**
 * Pseudo-localization generator.
 *
 *   pnpm i18n:pseudo         # generate <namespace>/en-XA.json from every en-US.json
 *   pnpm i18n:pseudo:check   # regenerate to memory and fail if the on-disk file drifted
 *
 * en-XA is the industry pseudo-locale (W3C / Chrome / Android). See
 * scripts/i18n/pseudo.mjs for the transform rules and rationale.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { transformResource } from "./i18n/pseudo.mjs";

const root = process.cwd();
const sourceRoots = ["apps/web/src", "packages"];
const SOURCE_LOCALE = "en-US";
const PSEUDO_LOCALE = "en-XA";
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", ".turbo", ".next", "coverage"]);

async function walkI18nDirs(dir, matcher) {
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
      results.push(...await walkI18nDirs(fullPath, matcher));
      continue;
    }
    if (!matcher(entry.name)) continue;
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
    files.push(...await walkI18nDirs(path.join(root, sourceRoot), (name) => name === `${SOURCE_LOCALE}.json`));
  }
  return files.sort();
}

async function collectExistingPseudo() {
  const files = [];
  for (const sourceRoot of sourceRoots) {
    files.push(...await walkI18nDirs(path.join(root, sourceRoot), (name) => name === `${PSEUDO_LOCALE}.json`));
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

function abortIfNoSources(sources) {
  if (sources.length === 0) {
    console.error(
      `No ${SOURCE_LOCALE}.json files found under ${sourceRoots.join(", ")}.\n` +
      `This is almost certainly a scanner bug — refusing to succeed silently. ` +
      `If ${SOURCE_LOCALE} really was removed, update sourceRoots or delete this script.`,
    );
    process.exit(1);
  }
}

async function generate() {
  const sources = await collectSources();
  abortIfNoSources(sources);
  const expectedOutputs = new Set();
  for (const source of sources) {
    const { outputPath, serialized } = await pseudoForSource(source);
    await fs.writeFile(outputPath, serialized, "utf8");
    expectedOutputs.add(path.resolve(outputPath));
    console.log(`wrote ${path.relative(root, outputPath)}`);
  }
  const orphaned = (await collectExistingPseudo()).filter((p) => !expectedOutputs.has(path.resolve(p)));
  if (orphaned.length > 0) {
    console.warn(`Orphan ${PSEUDO_LOCALE}.json (no sibling ${SOURCE_LOCALE}.json — delete manually):`);
    for (const item of orphaned) console.warn(`- ${path.relative(root, item)}`);
  }
  console.log(`i18n pseudo generated: ${sources.length} locale file(s).`);
}

async function check() {
  const sources = await collectSources();
  abortIfNoSources(sources);
  const drift = [];
  const missing = [];
  const expectedOutputs = new Set();
  for (const source of sources) {
    const { outputPath, serialized } = await pseudoForSource(source);
    expectedOutputs.add(path.resolve(outputPath));
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
  const orphaned = (await collectExistingPseudo())
    .filter((p) => !expectedOutputs.has(path.resolve(p)))
    .map((p) => path.relative(root, p));

  if (missing.length === 0 && drift.length === 0 && orphaned.length === 0) {
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
  if (orphaned.length > 0) {
    console.error(`Orphan ${PSEUDO_LOCALE}.json (no sibling ${SOURCE_LOCALE}.json — delete manually):`);
    for (const item of orphaned) console.error(`- ${item}`);
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
