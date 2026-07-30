import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contract for the patched Excalidraw vendor bundle's code-split graph.
 *
 * Excalidraw code-splits its UI locales AND its lazy runtime modules into content-hashed chunks and
 * reaches each through a relative `import("./…")` / `from "./…"`. The chunk filenames AND the
 * minified export names inside them are per-build, so `dist/dev` and `dist/prod` ship the SAME
 * modules under DIFFERENT filenames and DIFFERENT symbol names. Regenerating only part of the prod
 * bundle — or splicing dev-flavoured code into it — produces two failure modes that BOTH surface
 * only in a production build (`pnpm --filter @octo/web build`):
 *
 *   1. Missing file — an `import("./data/image-YKVTEDFW.js")` where only the prod hash
 *      `image-GAAHSSAO.js` was ever emitted (a dev chunk hash leaked into the prod index).
 *   2. Missing export — a module importing a NAME the target chunk does not export, e.g. the prod
 *      index importing `en_default` / `__export` (dev/unmangled names) from chunks that export `J` /
 *      `c`, or the `./data/image-*.js` chunk importing `nh, oh, ph` after the K2UTITRG chunk was
 *      rebuilt to export `getTEXtChunk, encodePngMetadata, decodePngMetadata`.
 *
 * These assertions are cheap (regex sweeps + set lookups over the vendored bundle) and fail fast the
 * moment the patch drifts, without needing a full app build. Named-export checks are restricted to
 * targets whose exports are expressed purely as `export{…}` blocks (all the split chunks) — files
 * that also use `export const/function` (e.g. `octo-native-shapes.js`) are only checked for
 * on-disk existence, since their export list can't be parsed statically without a JS parser.
 */
const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(dirname(require.resolve('@excalidraw/excalidraw'))))
const distDir = (mode: 'dev' | 'prod'): string => join(packageRoot, 'dist', mode)

const readIndex = (mode: 'dev' | 'prod'): string => readFileSync(join(distDir(mode), 'index.js'), 'utf8')

function walkJs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walkJs(full)
    return entry.name.endsWith('.js') ? [full] : []
  })
}

/** Every relative specifier the index can load, restricted to real `.js`/`.css` chunks. */
function relativeImports(mode: 'dev' | 'prod'): string[] {
  const index = readIndex(mode)
  return [
    ...new Set(
      [...index.matchAll(/(?:import\s*\(|import\s+|from\s+)"(\.\/[^"]+\.(?:js|css))"/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort()
}

function localeImports(mode: 'dev' | 'prod'): string[] {
  const index = readIndex(mode)
  return [
    ...new Set(
      [...index.matchAll(/import\("\.\/locales\/([^"]+\.js)"\)/g)].map((match) => match[1]),
    ),
  ].sort()
}

const dataImports = (mode: 'dev' | 'prod'): string[] =>
  relativeImports(mode).filter((file) => file.startsWith('./data/'))

const localeName = (file: string): string =>
  file.replace(/^\.\/locales\//, '').replace(/-[A-Z0-9]{8}\.js$/, '')

const chunkName = (file: string): string => file.replace(/-[A-Z0-9]{8}(\.[a-z]+)$/, '$1')

/** Static named imports across the whole dist mode: `import{ a as b, … } from "./spec"`. */
interface NamedImport {
  fromFile: string
  spec: string
  name: string
}
function namedImports(mode: 'dev' | 'prod'): NamedImport[] {
  return walkJs(distDir(mode)).flatMap((file) => {
    const src = readFileSync(file, 'utf8')
    return [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].flatMap((match) =>
      match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => ({ fromFile: file, spec: match[2], name: part.split(/\s+as\s+/)[0].trim() })),
    )
  })
}

/**
 * The set of names a chunk exports, IF (and only if) it declares them exclusively via `export{…}`
 * blocks. Files that also use `export const/function/class/default` (dynamic declarations) return
 * `null` — we can't enumerate their exports with a regex, so their importers are skipped by the
 * named-export check and rely on the build itself.
 */
function staticExports(file: string): Set<string> | null {
  const src = readFileSync(file, 'utf8')
  if (/export\s+(?:const|let|var|function|class|default|async\s+function)\b/.test(src)) return null
  const names = new Set<string>()
  for (const block of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const token = part.trim()
      if (!token) continue
      const pair = token.split(/\s+as\s+/)
      names.add((pair[1] ?? pair[0]).trim())
    }
  }
  return names
}

/**
 * The names an `index.js` re-exports through `export{…}` blocks, ignoring any `export const/function`
 * it also carries (so unlike {@link staticExports} it never bails to null). Used to pin the runtime
 * helpers the board rich-text panel depends on at the package entry point.
 */
function indexExportNames(mode: 'dev' | 'prod'): Set<string> {
  const src = readIndex(mode)
  const names = new Set<string>()
  for (const block of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const token = part.trim()
      if (!token) continue
      const pair = token.split(/\s+as\s+/)
      names.add((pair[1] ?? pair[0]).trim())
    }
  }
  return names
}

describe.each(['dev', 'prod'] as const)('patched Excalidraw %s bundle loader contract', (mode) => {
  const imports = relativeImports(mode)
  const locales = localeImports(mode)

  it('resolves every relative import in index.js to a file that exists on disk', () => {
    // Build-breaking invariant #1: any specifier the index reaches must have been emitted into this
    // same dist mode. Catches a dev chunk hash (e.g. image-YKVTEDFW.js) leaking into prod.
    const missing = imports.filter((file) => !existsSync(join(distDir(mode), file)))
    expect(missing).toEqual([])
  })

  it('resolves every lazy ./data chunk (e.g. PNG metadata for export-embed)', () => {
    // The `./data/image-*.js` chunk is only pulled in on the export-embed path, so a broken hash
    // here never trips a smoke render — only a full production build. Guard it explicitly.
    expect(dataImports(mode).length).toBeGreaterThanOrEqual(1)
    const missing = dataImports(mode).filter((file) => !existsSync(join(distDir(mode), file)))
    expect(missing).toEqual([])
  })

  it('resolves every named import to a symbol its target chunk actually exports', () => {
    // Build-breaking invariant #2: importing a NAME the target does not export. Catches dev/unmangled
    // symbol names spliced into the prod index (en_default, __export, …) and stale data-chunk imports
    // (nh/oh/ph) after a chunk was rebuilt under different export names.
    const unresolved = namedImports(mode)
      .filter((imp) => imp.spec.startsWith('.'))
      .map((imp) => ({ ...imp, target: resolve(dirname(imp.fromFile), imp.spec) }))
      .filter((imp) => existsSync(imp.target))
      .filter((imp) => {
        const exports = staticExports(imp.target)
        return exports !== null && !exports.has(imp.name)
      })
      .map((imp) => `${imp.name} <- ${imp.spec} (in ${imp.fromFile.slice(packageRoot.length)})`)
    expect(unresolved).toEqual([])
  })

  it('resolves every relative named import across ALL chunks to a file on disk', () => {
    // Closes the hole yujiawei P2-5 flagged: the named-EXPORT check above drops a missing target with
    // `existsSync` before it can fail, and the index-only existence check (#1) never sees non-index
    // files. So a relative specifier in ANY chunk pointing at a never-emitted file would pass both.
    // Invert the filter here: a missing target must surface, not vanish.
    const missing = [
      ...new Set(
        namedImports(mode)
          .filter((imp) => imp.spec.startsWith('.'))
          .filter((imp) => !existsSync(resolve(dirname(imp.fromFile), imp.spec)))
          .map((imp) => `${imp.spec} (in ${imp.fromFile.slice(packageRoot.length)})`),
      ),
    ].sort()
    expect(missing).toEqual([])
  })

  it('exports the runtime helpers the board rich-text panel depends on', () => {
    // yujiawei P2-3: BoardShell threads mutateElement / redrawTextBoundingBox / FONT_FAMILY out of the
    // dynamic `@excalidraw/excalidraw` import into NativePanelTextControls (the P1-2 lazy-import fix).
    // If a patch regeneration drops any of them the entire rich-text panel silently stops rendering —
    // BoardShell only wires the runtime `if (m.mutateElement && m.redrawTextBoundingBox)` — while every
    // unit test stays green because they mock the module. Pin the three symbols at the package entry.
    const exports = indexExportNames(mode)
    for (const name of ['mutateElement', 'redrawTextBoundingBox', 'FONT_FAMILY']) {
      expect(exports.has(name), `${mode} bundle index.js must export ${name}`).toBe(true)
    }
  })

  it('imports at least the full upstream locale catalogue', () => {
    // The upstream package ships 50+ locales; a truncated import table means the loader was rebuilt
    // against a partial locale set.
    expect(locales.length).toBeGreaterThanOrEqual(50)
  })

  it('imports en-US and zh-CN so the default locales are always loadable', () => {
    expect(locales.some((file) => localeName(file) === 'en')).toBe(true)
    expect(locales.some((file) => localeName(file) === 'zh-CN')).toBe(true)
  })
})

it('keeps dev and prod locale sets synchronized under distinct per-build hashes', () => {
  const dev = localeImports('dev')
  const prod = localeImports('prod')

  // Same locales in both bundles — neither may drop a translation the other ships.
  expect(prod.map(localeName)).toEqual(dev.map(localeName))

  // But prod must carry its OWN content hashes: reusing the dev filenames is exactly the regression
  // that leaves prod importing chunks that were never emitted into dist/prod/locales.
  expect(prod).not.toEqual(dev)
  const devFiles = new Set(dev)
  expect(prod.filter((file) => devFiles.has(file))).toEqual([])
})

it('keeps dev and prod ./data chunks synchronized under distinct per-build hashes', () => {
  const dev = dataImports('dev')
  const prod = dataImports('prod')

  // Same logical chunks in both bundles (compared by hash-stripped name).
  expect(prod.map(chunkName)).toEqual(dev.map(chunkName))

  // ...but never the same filename. `./data/image-YKVTEDFW.js` (a dev hash) appearing in the prod
  // index was the original blocker; assert prod can never reuse a dev data-chunk filename again.
  const devFiles = new Set(dev)
  expect(prod.filter((file) => devFiles.has(file))).toEqual([])
})
