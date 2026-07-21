// Per-workspace @-mention recency in localStorage, so recently-delegated
// targets surface first. No-op when storage is unavailable.

type RecencyMap = Record<string, number>;

// octo-branded key — never leak the upstream product name into storage.
const STORAGE_PREFIX = "octo:loop:mention-recency:";
const MAX_ENTRIES = 200;

function storageKey(wsId: string): string {
  return `${STORAGE_PREFIX}${wsId}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(wsId: string): RecencyMap {
  const s = storage();
  if (!s || !wsId) return {};
  try {
    const parsed = JSON.parse(s.getItem(storageKey(wsId)) ?? "null");
    // typeof [] === "object": reject arrays so a corrupted slot degrades to {} instead of
    // silently writing string keys onto an array (which JSON.stringify then drops).
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RecencyMap) : {};
  } catch {
    return {};
  }
}

function write(wsId: string, map: RecencyMap): void {
  const s = storage();
  if (!s || !wsId) return;
  try {
    s.setItem(storageKey(wsId), JSON.stringify(map));
  } catch {
    /* quota exceeded or storage disabled — skip silently */
  }
}

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

export function getRecencyMap(wsId: string): RecencyMap {
  return read(wsId);
}

export function recordMentionUsage(wsId: string, item: { type: string; id: string }): void {
  if (!wsId) return;
  const map = read(wsId);
  map[key(item.type, item.id)] = Date.now();
  const entries = Object.entries(map);
  if (entries.length > MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b - a);
    const trimmed: RecencyMap = {};
    for (const [k, ts] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = ts;
    write(wsId, trimmed);
    return;
  }
  write(wsId, map);
}

// recency DESC, name ASC fallback.
export function sortByRecency<T extends { type: string; id: string; label: string }>(
  items: T[],
  recency: RecencyMap,
): T[] {
  return [...items].sort((a, b) => {
    const ra = recency[key(a.type, a.id)] ?? 0;
    const rb = recency[key(b.type, b.id)] ?? 0;
    if (ra !== rb) return rb - ra;
    return a.label.localeCompare(b.label);
  });
}

// Keep at most `perType` items of each type, preserving input order. Used in search
// mode so a flood of one type (e.g. members) can't crowd every expert/team out of a
// single global cap — every matching type stays reachable.
export function capPerType<T extends { type: string }>(items: T[], perType: number): T[] {
  const count: Record<string, number> = {};
  return items.filter((it) => {
    const n = (count[it.type] ?? 0) + 1;
    count[it.type] = n;
    return n <= perType;
  });
}
