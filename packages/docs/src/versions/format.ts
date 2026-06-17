// Relative / absolute timestamp formatting for the version list (feature #4 §1.1).
//
// The list shows a compact relative time ("3m ago") with the full local timestamp on
// hover (title attr). Pure functions over an ISO string so they're trivially testable.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago", else a date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const delta = now - t
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Full local timestamp for the hover title. */
export function formatAbsolute(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** "Autosave HH:mm" fallback label for unnamed auto snapshots. */
export function autosaveLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Autosave'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `Autosave ${hh}:${mm}`
}
