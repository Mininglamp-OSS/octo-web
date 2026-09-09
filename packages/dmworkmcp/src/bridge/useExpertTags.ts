import { useCallback, useEffect, useState } from "react";
import { listExpertTags } from "../api/expertService";
import type { ExpertKindParam } from "../api/expertService";
import { expertListErrorI18nKey } from "../api/expertListError";

interface TagOptions {
  kind: ExpertKindParam;
  mine: boolean;
  enabled: boolean;
  scopeKey: string;
  keyword?: string;
}

function emptyState(key: string, loading: boolean) {
  return {
    key,
    loading,
    items: [] as string[],
    errorKey: null as string | null,
  };
}

/** The tag API is bounded: search it instead of filtering its first 50 names. */
export function useExpertTags({
  kind,
  mine,
  enabled,
  scopeKey,
  keyword,
}: TagOptions) {
  const query = keyword?.trim() ?? "";
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([scopeKey, query, revision]);
  const [state, setState] = useState(() => emptyState(key, enabled));

  useEffect(() => {
    let cancelled = false;
    setState(emptyState(key, enabled));
    const timer = enabled
      ? window.setTimeout(
          async () => {
            try {
              const items = await listExpertTags(kind, {
                mine,
                ...(query ? { keyword: query } : {}),
              });
              if (!cancelled)
                setState({ key, items, loading: false, errorKey: null });
            } catch (err) {
              if (!cancelled)
                setState({
                  ...emptyState(key, false),
                  errorKey: expertListErrorI18nKey(err),
                });
            }
          },
          query ? 250 : 0
        )
      : undefined;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, kind, mine, enabled, query]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { ...(state.key === key ? state : emptyState(key, enabled)), reload };
}
