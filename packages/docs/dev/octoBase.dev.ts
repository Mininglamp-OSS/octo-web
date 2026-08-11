// Dev-only `@octo/base` stand-in for the docs standalone harness (aliased in vite.dev.config.ts).
//
// The real `@octo/base` (packages/dmworkbase) is a React 17 host that would conflict with this
// package's React 18 and pull the entire app tree into the dev server. For the M1 standalone
// whiteboard verification we don't need the host — only the small seam octoweb/index.ts imports:
// WKApp / Menus / SpaceService (taken straight from the existing test mock) plus a *working* i18n
// so the UI shows real translated strings (not raw keys) when driving the browser.
//
// This file is NEVER part of the production build: apps/web builds docs against the real
// `@octo/base`. It exists purely so `pnpm --filter @octo/docs dev:standalone` can run.

import { useSyncExternalStore } from 'react'

export {
  WKApp,
  Menus,
  SpaceService,
  VoiceInputButton,
  titleContextStore,
  // WuKongIM chat primitives the octoweb seam imports unconditionally (embedded bot-DM shell).
  // They must be re-exported even though no harness renders the DM surface: `src/octoweb/index.ts`
  // imports them at module scope, so a missing export breaks EVERY standalone harness with
  // "does not provide an export named 'Channel'" before a single component mounts.
  Channel,
  ChannelTypePerson,
  Conversation,
  MAX_MESSAGE_LENGTH,
} from "../src/__mocks__/octoBase.ts";
export type { SpaceMember } from "../src/__mocks__/octoBase.ts";

type Tree = Record<string, unknown>

const namespaces = new Map<string, Tree>()
const localeListeners = new Set<() => void>()
let locale = (() => {
  try {
    return window.localStorage.getItem('octo.dev.locale') || 'zh-CN'
  } catch {
    return 'zh-CN'
  }
})()

function lookup(tree: Tree | undefined, path: string[]): string | undefined {
  let cur: unknown = tree
  for (const seg of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Tree)[seg]
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(s: string, values?: Record<string, unknown>): string {
  if (!values) return s
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] != null ? String(values[k]) : `{{${k}}}`))
}

export const i18n = {
  registerNamespace(ns: string, resources: Record<string, Tree>): void {
    // Store the per-locale resource trees so t() can resolve `<ns>.a.b` keys.
    namespaces.set(ns, (resources as Record<string, Tree>) as unknown as Tree)
  },
  init(): void {},
  getLocale(): string {
    return locale
  },
  setLocale(next: string): void {
    if (next === locale) return
    locale = next
    try {
      window.localStorage.setItem('octo.dev.locale', next)
    } catch {
      /* ignore */
    }
    for (const listener of localeListeners) listener()
  },
}

export function t(key: string, values?: Record<string, unknown>): string {
  const [ns, ...rest] = key.split('.')
  const byLocale = namespaces.get(ns) as Record<string, Tree> | undefined
  const tree = byLocale?.[locale] ?? byLocale?.['en-US']
  const hit = lookup(tree, rest)
  // Production call sites use the real @octo/base signature `t(key, { values: {...} })`; some dev
  // code passes the value bag directly. Accept BOTH — otherwise every `{{seq}}` placeholder
  // survives into the rendered string and a dev screenshot lies about what production shows.
  const bag =
    values && typeof values.values === 'object' && values.values !== null
      ? (values.values as Record<string, unknown>)
      : values
  return hit != null ? interpolate(hit, bag) : key
}

export function useI18n(): {
  t: (key: string, values?: Record<string, unknown>) => string
  locale: string
} {
  const currentLocale = useSyncExternalStore(
    (listener) => {
      localeListeners.add(listener)
      return () => localeListeners.delete(listener)
    },
    () => locale,
    () => locale,
  )
  return { t, locale: currentLocale }
}
