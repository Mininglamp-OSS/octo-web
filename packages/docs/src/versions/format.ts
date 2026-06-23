// Relative / absolute timestamp formatting (feature #4 §1.1, shared by versions / comments / members).
//
// The list shows a compact relative time ("3m ago") with the full local timestamp on
// hover (title attr). The relative strings are i18n-aware: each function takes a
// translator so the same logic works for both locales and stays trivially unit-testable
// (pass a fake translator in tests; the seam's `t` is the default in app code).

import { t as defaultTranslate } from '../octoweb/index.ts'

/**
 * Translator shape used by the time formatters — structurally the seam's `t` (and the
 * test stub). `values` are interpolated into the message ("{{n}}m ago" → "3m ago").
 */
export type Translate = (key: string, opts?: { values?: Record<string, unknown> }) => string

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Compact relative time: "just now", "5m ago", "3h ago", "2d ago", else a locale date.
 * The bucket strings come from docs.time.* so they localize; only the >7d branch falls
 * back to the platform `toLocaleDateString()` (already locale-aware).
 */
export function formatRelative(
  iso: string,
  translate: Translate = defaultTranslate,
  now: number = Date.now(),
): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const delta = now - time
  if (delta < MINUTE) return translate('docs.time.justNow')
  if (delta < HOUR) return translate('docs.time.minutesAgo', { values: { n: Math.floor(delta / MINUTE) } })
  if (delta < DAY) return translate('docs.time.hoursAgo', { values: { n: Math.floor(delta / HOUR) } })
  if (delta < 7 * DAY) return translate('docs.time.daysAgo', { values: { n: Math.floor(delta / DAY) } })
  return new Date(iso).toLocaleDateString()
}

/** Full local timestamp for the hover title. */
export function formatAbsolute(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** "Autosave HH:mm" fallback label for unnamed auto snapshots (i18n-aware). */
export function autosaveLabel(iso: string, translate: Translate = defaultTranslate): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return translate('docs.time.autosavePlain')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return translate('docs.time.autosave', { values: { time: `${hh}:${mm}` } })
}
