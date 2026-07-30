import { useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../api/driveApi';
import type { OrgCandidate } from '../bridge/types';

/** Debounce keystrokes before hitting the proxied octo-server user search. */
const DEBOUNCE_MS = 250;
const LIMIT = 20;

export interface UseOrgSearchResult {
  candidates: OrgCandidate[];
  loading: boolean;
  query: string;
  search: (q: string) => void;
}

/**
 * Debounced org-member picker source, proxied through drive. A non-empty query
 * keyword-searches octo-server (/v1/user/search); an empty query lists the
 * caller's current octo space members (drive branches on the X-Space-Id header
 * the api layer sends), so the picker shows the team by default. An
 * AbortController drops out-of-order responses so the last keystroke wins.
 */
export function useOrgSearch(spaceId?: string): UseOrgSearchResult {
  const [candidates, setCandidates] = useState<OrgCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (q: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await api.searchOrgUser({ q, space_id: spaceId, limit: LIMIT }, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setCandidates(res.candidates ?? []);
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        setCandidates([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [spaceId],
  );

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => run(q), DEBOUNCE_MS);
    },
    [run],
  );

  // On a space switch, synchronously drop everything scoped to the previous
  // space: cancel the pending debounce, abort the in-flight request (each run's
  // AbortController doubles as its generation guard, so a late Space A response
  // returns early instead of writing back), and clear query/candidates now.
  // Without this the picker keeps showing — and lets a user select — Space A's
  // members during the window before Space B's debounced load resolves. The
  // caller triggers a fresh load for the new space when the picker (re)opens.
  // Skip the initial mount: there is no previous space to reset.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    setCandidates([]);
    setQuery('');
    setLoading(false);
  }, [spaceId]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  return { candidates, loading, query, search };
}
