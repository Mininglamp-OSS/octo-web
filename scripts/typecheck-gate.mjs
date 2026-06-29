#!/usr/bin/env node
/**
 * typecheck baseline gate (#476)
 *
 * Runs `tsc --noEmit` for apps/web (whose tsconfig pulls in every package's
 * source via path resolution, so this is effectively a whole-repo type check)
 * and compares the result against a committed baseline snapshot.
 *
 * Why a baseline instead of "fix everything first": of the ~167 existing
 * errors, 44 originate in third-party `.tsx` under node_modules (e.g.
 * @douyinfe/semi-ui) that we cannot fix and that `skipLibCheck` does not cover
 * (it only covers `.d.ts`). Requiring zero errors would mean the gate can never
 * be turned on. This gate instead freezes the current errors and fails CI only
 * on NEWLY introduced ones — so type safety stops regressing today, while the
 * existing debt is burned down separately (tracked in #476 follow-up).
 *
 * Signature = `file: TScode` (count per signature). The (line,col) AND the
 * message body are intentionally dropped: tsc's message text is NOT stable for
 * the same source — union members are emitted in non-deterministic order and
 * the truncated "...N more" representative member varies between runs — so
 * keying on the message produced phantom regressions on a clean tree. Keying on
 * file+code is reproducible; counting per signature still catches a new error
 * of an existing shape (count goes up). New file or new error code → caught.
 *
 * Two robustness rules (PR #490 review, credit @yujiawei):
 *  - The pnpm virtual-store version segment is stripped from paths
 *    (`.pnpm/<pkg>@<ver>_<hash>/` → `.pnpm/<pkg>/`) so third-party baseline
 *    signatures don't false-fail when an unrelated dependency is bumped.
 *  - Position-less diagnostics (`error TSxxxx:` with no `(line,col)`, e.g.
 *    TS18003 no-inputs, config/CLI errors) are still counted, and a tsc crash
 *    that yields zero parseable diagnostics fails closed — the gate must never
 *    go green because its own checker broke.
 *
 * Usage:
 *   node scripts/typecheck-gate.mjs            # gate: fail if new errors
 *   node scripts/typecheck-gate.mjs --update   # regenerate the baseline
 */
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE = join(root, "scripts", "typecheck-baseline.txt")

function collectErrors() {
  let out = ""
  let tscFailed = false
  try {
    out = execSync("pnpm exec tsc --noEmit -p tsconfig.json", {
      cwd: join(root, "apps", "web"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    // tsc exits non-zero when there are errors; its report is on stdout.
    tscFailed = true
    out = `${e.stdout || ""}${e.stderr || ""}`
  }
  const sigs = new Map()
  for (const line of out.split("\n")) {
    // Position-bearing diagnostics: `file(line,col): error TSxxxx: msg`.
    let m = line.match(/^(.*?)\((\d+),(\d+)\): (error TS\d+):/)
    let file, code
    if (m) {
      file = m[1]
      code = m[4]
    } else {
      // Position-less diagnostics: `file: error TSxxxx: msg` or bare
      // `error TSxxxx: msg` (e.g. TS18003 No inputs found, TS5083 config
      // errors, OOM). These have no (line,col) but MUST still be counted —
      // otherwise a new project/config error of this class slips through green.
      const m2 = line.match(/^(?:(.*?): )?(error TS\d+):/)
      if (!m2) continue
      file = m2[1] || "<global>"
      code = m2[2]
    }
    // Strip pnpm's virtual-store version segment so third-party signatures are
    // stable across dependency bumps: `.pnpm/<pkg>@<ver>_<hash>/` → `.pnpm/<pkg>/`.
    file = file.replace(/(\.pnpm\/[^/]+?)@[^/]+/, "$1")
    const signature = `${file}: ${code}` // file + TS code (message dropped — not reproducible)
    sigs.set(signature, (sigs.get(signature) || 0) + 1)
  }
  // A checker crash with no parseable diagnostics must fail closed, not green:
  // tsc exited non-zero yet we extracted nothing (config parse error, OOM, CLI
  // failure). Returning an empty map here would report "OK" and defeat the gate.
  if (tscFailed && sigs.size === 0) {
    console.error(
      "[typecheck-gate] tsc exited non-zero but produced no parseable diagnostics " +
        "(config/CLI/OOM failure?). Failing closed.\n",
    )
    console.error(out.slice(0, 4000))
    process.exit(1)
  }
  return sigs
}

function readBaseline() {
  if (!existsSync(BASELINE)) return new Map()
  const sigs = new Map()
  for (const line of readFileSync(BASELINE, "utf8").split("\n")) {
    const m = line.match(/^(\d+)\t(.*)$/)
    if (m) sigs.set(m[2], Number(m[1]))
  }
  return sigs
}

function serialize(sigs) {
  return (
    [...sigs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sig, n]) => `${n}\t${sig}`)
      .join("\n") + "\n"
  )
}

const current = collectErrors()
const total = [...current.values()].reduce((a, b) => a + b, 0)

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, serialize(current))
  console.log(`[typecheck-gate] baseline written: ${current.size} signatures, ${total} errors`)
  process.exit(0)
}

const baseline = readBaseline()
const newErrors = []
for (const [sig, count] of current) {
  const allowed = baseline.get(sig) || 0
  if (count > allowed) newErrors.push(`+${count - allowed}  ${sig}`)
}

const baselineTotal = [...baseline.values()].reduce((a, b) => a + b, 0)
console.log(
  `[typecheck-gate] baseline ${baselineTotal} errors, current ${total} errors, ` +
    `${newErrors.length} signature(s) regressed`,
)

if (newErrors.length > 0) {
  console.error("\n[typecheck-gate] NEW type errors introduced (fix these):\n")
  for (const e of newErrors) console.error("  " + e)
  console.error(
    "\nIf you intentionally changed types, run `node scripts/typecheck-gate.mjs --update` and commit the baseline.",
  )
  process.exit(1)
}
console.log("[typecheck-gate] OK — no new type errors.")
process.exit(0)
