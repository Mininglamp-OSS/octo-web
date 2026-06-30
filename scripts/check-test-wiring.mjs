#!/usr/bin/env node
/**
 * test-wiring gate (Critical Rule 7 — anti "green-by-non-execution").
 *
 * `turbo run test` only runs packages that define a `test` script; a package
 * that ships test files but forgets to wire the script is SILENTLY SKIPPED, so
 * CI goes green while real tests never execute. That actually happened on this
 * repo (dmworkcontacts / dmworktodo shipped vitest.config + test files with no
 * `test` script — 41 tests ran in zero CI jobs).
 *
 * This gate scans every workspace package; if a package contains a *.test.* or
 * *.spec.* file but has no `test` script, it fails CI. So the gate cannot be
 * defeated by adding tests without wiring them — the missing script is caught.
 *
 * Usage: node scripts/check-test-wiring.mjs   (exit 1 on any offender)
 */
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORKSPACE_DIRS = ["apps", "packages"]
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"])

function hasTestFile(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (hasTestFile(p)) return true
    } else if (TEST_FILE.test(e.name)) {
      return true
    }
  }
  return false
}

const offenders = []
for (const ws of WORKSPACE_DIRS) {
  const wsDir = join(root, ws)
  if (!existsSync(wsDir)) continue
  for (const name of readdirSync(wsDir)) {
    const pkgDir = join(wsDir, name)
    if (!statSync(pkgDir).isDirectory()) continue
    const pkgJsonPath = join(pkgDir, "package.json")
    if (!existsSync(pkgJsonPath)) continue
    const scanRoot = existsSync(join(pkgDir, "src")) ? join(pkgDir, "src") : pkgDir
    if (!hasTestFile(scanRoot)) continue
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"))
    if (!pkg.scripts || !pkg.scripts.test) offenders.push(`${ws}/${name}`)
  }
}

if (offenders.length > 0) {
  console.error(
    '[check-test-wiring] FAIL — these packages ship test files but have NO "test" script,\n' +
      "so `turbo run test` SILENTLY SKIPS them (Critical Rule 7: green-by-non-execution):\n",
  )
  for (const o of offenders) console.error(`  ${o}`)
  console.error('\nFix: add  "test": "vitest run"  to each package.json above.')
  process.exit(1)
}
console.log("[check-test-wiring] OK — every package with test files has a test script.")
process.exit(0)
