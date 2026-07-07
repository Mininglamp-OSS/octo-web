// Local, dependency-light re-implementation of @univerjs/presets' `createUniver` (§B5).
//
// WHY THIS EXISTS: the umbrella `@univerjs/presets` package is convenient, but as a
// DEPENDENCY it pulls the entire preset family into the install tree — including
// `@univerjs/preset-sheets-advanced` and `@univerjs/preset-sheets-collaboration`, which
// depend on the PAID `@univerjs-pro/*` packages. We use only the OSS sheets-core preset
// (`@univerjs/preset-sheets-core`, whose own deps are all OSS `@univerjs/*`), so we drop
// `@univerjs/presets` entirely and reproduce its thin `createUniver` scaffolding here
// against `@univerjs/core` (OSS). No `@univerjs-pro/*` ends up in the dependency tree.
//
// Behaviour matches the upstream helper 1:1 (see @univerjs/presets/lib/es/index.js):
//   - `collaboration: true` nulls out IUndoRedoService / IAuthzIoService / IMentionIOService
//     (their client is provided by the Pro collab plugin, which we don't use — but we keep
//     the flag for parity; our sheet passes only `presets`).
//   - each preset's plugins are registered, deduped by pluginName (last registration wins).
//   - extra `plugins` throw if they collide with a preset's plugin (same guard as upstream).
//   - remaining config (locale / locales / darkMode / …) passes straight to `new Univer`.

import { Univer, LogLevel, IUndoRedoService, IAuthzIoService, IMentionIOService } from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'

/** A Univer plugin constructor carries a static `pluginName` used for dedup. */
interface PluginCtor {
  pluginName: string
}
/** A plugin, optionally paired with its options: `Ctor` or `[Ctor, options]`. */
type PluginEntry = PluginCtor | [PluginCtor, unknown]
/** A preset bundles a set of plugin entries. */
interface Preset {
  plugins: PluginEntry[]
}
/** A preset, optionally wrapped in a tuple (upstream accepts both). */
type PresetEntry = Preset | [Preset]

export interface CreateUniverConfig {
  presets?: PresetEntry[]
  plugins?: PluginEntry[]
  collaboration?: boolean
  override?: Array<[unknown, unknown]>
  /** locale / locales / darkMode / logLevel etc. — forwarded verbatim to `new Univer`. */
  [key: string]: unknown
}

function splitEntry(entry: PluginEntry): [PluginCtor, unknown] {
  return Array.isArray(entry) ? [entry[0], entry[1]] : [entry, undefined]
}

export function createUniver(config: CreateUniverConfig): { univer: Univer; univerAPI: FUniver } {
  const { presets, plugins, collaboration, override = [], ...rest } = config
  if (collaboration) {
    override.push([IUndoRedoService, null], [IAuthzIoService, null], [IMentionIOService, null])
  }
  const univer = new Univer({ logLevel: LogLevel.WARN, ...rest, override } as never)

  // Collect plugins from all presets, deduping by pluginName (last wins — upstream behaviour).
  const registry = new Map<string, { plugin: PluginCtor; options: unknown }>()
  presets?.forEach((p) => {
    const preset = Array.isArray(p) ? p[0] : p
    preset.plugins.forEach((entry) => {
      const [plugin, options] = splitEntry(entry)
      registry.delete(plugin.pluginName)
      registry.set(plugin.pluginName, { plugin, options })
    })
  })
  // Standalone plugins must not collide with a preset's plugin (upstream throws here too).
  plugins?.forEach((entry) => {
    const [plugin, options] = splitEntry(entry)
    if (registry.has(plugin.pluginName)) {
      throw new Error(
        `Plugin ${plugin.pluginName} already registered by presets or other ways! Repeated registration may cause potential problems, please check your code.`,
      )
    }
    registry.set(plugin.pluginName, { plugin, options })
  })
  registry.forEach(({ plugin, options }) => {
    univer.registerPlugin(plugin as never, options as never)
  })

  return { univer, univerAPI: FUniver.newAPI(univer) }
}
