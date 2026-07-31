import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const patchPath = join(root, 'patches/@excalidraw__excalidraw@0.18.1.patch')
const originalPatch = await readFile(patchPath)
const temporaryRoot = await mkdtemp(join(tmpdir(), 'octo-web-cache-key-'))
const cacheDirectory = join(temporaryRoot, 'turbo-cache')
const probe = Buffer.concat([originalPatch, Buffer.from('\n# web-build-cache-key-probe\n')])
const taskId = '@octo/web#build'
const taskLogPrefix = '@octo/web:build'
const cacheLinePattern = /cache (miss), executing ([a-f0-9]+)|cache (hit), (?:replaying|suppressing) logs ([a-f0-9]+)/

function parseWebBuildCacheResult(output, label) {
  const lines = output.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const prefixed = line.match(new RegExp(`^${taskLogPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (.*)$`))
    if (prefixed) {
      const match = prefixed[1].match(cacheLinePattern)
      if (match) return { status: match[1] ?? match[3], hash: match[2] ?? match[4] }
    }

    // Turbo 2.2.1 uses GitHub Actions groups in CI. Only accept a bare cache line
    // inside @octo/web:build's group so another task cannot satisfy this assertion.
    if (line === `::group::${taskLogPrefix}` || line === `##[group]${taskLogPrefix}`) {
      for (let groupIndex = index + 1; groupIndex < lines.length; groupIndex += 1) {
        if (lines[groupIndex] === '::endgroup::' || lines[groupIndex] === '##[endgroup]') break
        const match = lines[groupIndex].match(cacheLinePattern)
        if (match) return { status: match[1] ?? match[3], hash: match[2] ?? match[4] }
      }
    }
  }
  throw new Error(`${label}: could not determine ${taskId} cache status/hash\n${output}`)
}

// Keep both Turbo output contracts executable even when this script runs outside GHA.
for (const [fixture, expected] of [
  [`${taskLogPrefix}: cache miss, executing abc123`, { status: 'miss', hash: 'abc123' }],
  [`::group::${taskLogPrefix}\ncache hit, replaying logs def456\n::endgroup::`, { status: 'hit', hash: 'def456' }],
  [`##[group]${taskLogPrefix}\ncache miss, executing 789abc\n##[endgroup]`, { status: 'miss', hash: '789abc' }],
]) {
  const actual = parseWebBuildCacheResult(fixture, 'cache parser fixture')
  if (actual.status !== expected.status || actual.hash !== expected.hash) {
    throw new Error(`cache parser fixture mismatch: ${JSON.stringify({ actual, expected })}`)
  }
}
const protectedPaths = ['build', '.turbo'].map((name) => ({
  active: join(root, 'apps/web', name),
  // Keep backups outside the package so $TURBO_DEFAULT$ cannot hash them.
  backup: join(root, `.verify-web-cache-backup-${name}-${process.pid}`),
  existed: false,
}))

for (const entry of protectedPaths) {
  try {
    await access(entry.active)
    entry.existed = true
    await rename(entry.active, entry.backup)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

const run = (command, args, label) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
  })
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`${label} failed (exit ${result.status ?? 'unknown'})\n${detail}`)
  }
  return `${result.stdout}\n${result.stderr}`
}

const webBuild = (label) => {
  const output = run(
    'pnpm',
    [
      'turbo',
      'run',
      'build',
      '--filter=@octo/web',
      '--no-daemon',
      `--cache-dir=${cacheDirectory}`,
      '--output-logs=hash-only',
    ],
    label,
  )
  return parseWebBuildCacheResult(output, label)
}

const verifyBundle = (label) => run('pnpm', ['verify:excalidraw-build'], label)

let baseline
let changed
let repeated
try {
  baseline = webBuild('baseline isolated build')
  if (baseline.status !== 'miss') throw new Error(`baseline isolated build should miss, got ${baseline.status}`)

  await writeFile(patchPath, probe)
  changed = webBuild('patch-only changed build')
  if (changed.status !== 'miss') throw new Error(`patch-only changed build should miss, got ${changed.status}`)
  if (changed.hash === baseline.hash) throw new Error(`patch-only change did not change ${taskId} hash (${baseline.hash})`)
  verifyBundle('bundle verification after patch-only cache miss')

  repeated = webBuild('unchanged repeat build')
  if (repeated.status !== 'hit') throw new Error(`unchanged repeat build should hit, got ${repeated.status}`)
  if (repeated.hash !== changed.hash) throw new Error(`unchanged repeat hash changed (${changed.hash} -> ${repeated.hash})`)
  verifyBundle('bundle verification after unchanged cache hit')
} finally {
  await writeFile(patchPath, originalPatch)
  await rm(temporaryRoot, { recursive: true, force: true })
  for (const entry of protectedPaths.reverse()) {
    await rm(entry.active, { recursive: true, force: true })
    if (entry.existed) await rename(entry.backup, entry.active)
  }
}

console.log([
  'Web build cache execution verified in an isolated Turbo cache:',
  `  baseline: miss ${baseline.hash}`,
  `  patch-only change: miss ${changed.hash}`,
  `  unchanged repeat: hit ${repeated.hash}`,
  '  Excalidraw production bundle verified after miss and hit',
].join('\n'))
