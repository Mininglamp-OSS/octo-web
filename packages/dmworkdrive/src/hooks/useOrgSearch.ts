import { useState, useCallback, useEffect, useRef } from 'react';
import { WKApp } from '@octo/base';
import { getPinyin } from '@octo/base/src/Utils/pinYin';
import { toSimplized } from '@octo/base/src/Utils/t2s';
import * as api from '../api/driveApi';
import type { OrgCandidate } from '../bridge/types';

export interface UseOrgSearchResult {
  candidates: OrgCandidate[];
  loading: boolean;
  query: string;
  search: (q: string) => void;
}

/** A candidate plus its precomputed lowercased "name\npinyin" match text. */
interface IndexedCandidate {
  item: OrgCandidate;
  searchText: string;
}

/** Build the local match text: name + its (simplified) pinyin, both lowercased. */
function buildSearchText(c: OrgCandidate): string {
  const name = (c.name || '').toLowerCase();
  const pinyin = getPinyin(toSimplized(name)).toLowerCase();
  return `${name}\n${pinyin}`;
}

function filterLocal(index: IndexedCandidate[], q: string): OrgCandidate[] {
  const kw = q.trim().toLowerCase();
  if (!kw) return index.map((e) => e.item);
  return index.filter((e) => e.searchText.includes(kw)).map((e) => e.item);
}

/**
 * Org-member picker source using a fetch-once-then-filter-locally model
 * (mirrors the contacts module): the full roster of the caller's current octo
 * space is fetched once when the picker mounts (i.e. on entering the drive) and
 * cached with a name+pinyin index. Keystrokes filter that cache locally with
 * zero backend calls.
 *
 * Re-fetch is keyed on the **host octo space**, not any drive space: the fetch
 * is scoped by the `X-Space-Id` header (= `WKApp.shared.currentSpaceId`) the api
 * layer injects at request time, and we reload when the host fires
 * `space-changed`. Switching between drive spaces (personal/shared) inside the
 * same octo space does NOT re-fetch — the roster is identical. On a host switch
 * we abort the in-flight request, synchronously drop the cache/query/candidates
 * (so a stale roster can't linger selectable during the reload window), and
 * start a fresh generation whose AbortController doubles as its guard, so a late
 * previous-generation response returns early instead of writing back. Unmount
 * removes the listener and aborts any pending request.
 */
export function useOrgSearch(): UseOrgSearchResult {
  const [candidates, setCandidates] = useState<OrgCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const indexRef = useRef<IndexedCandidate[]>([]);
  // Latest query, read when a fetch resolves so a keystroke made *during* the
  // load isn't clobbered by the full roster (F2). setQuery drives render; this
  // ref is the generation-safe copy the async continuation reads.
  const queryRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    // Supersede any in-flight generation, then drop the previous space's
    // cache/query/candidates synchronously.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    indexRef.current = [];
    queryRef.current = '';
    setQuery('');
    setCandidates([]);
    setLoading(true);
    void (async () => {
      try {
        const res = await api.listOrgMembers(ctrl.signal);
        if (ctrl.signal.aborted) return;
        const index = (res.candidates ?? []).map((item) => ({
          item,
          searchText: buildSearchText(item),
        }));
        indexRef.current = index;
        // Honour a query typed while the roster was loading (F2), not the full list.
        setCandidates(filterLocal(index, queryRef.current));
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError' || ctrl.signal.aborted) return;
        indexRef.current = [];
        setCandidates([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    WKApp.mittBus.on('space-changed', handler);
    return () => {
      WKApp.mittBus.off('space-changed', handler);
      abortRef.current?.abort();
    };
  }, [load]);

  const search = useCallback((q: string) => {
    queryRef.current = q;
    setQuery(q);
    setCandidates(filterLocal(indexRef.current, q));
  }, []);

  return { candidates, loading, query, search };
}
