import { useEffect, useState } from "react";
import { WKApp } from "@octo/base";
import { getMySkills } from "@dmwork/skillmarket";
import { subscribeReviewsChanged } from "@dmwork/skillmarket/src/api/reviewSignal";

/** Read the unfiltered owner catalog, stopping at the first outstanding item. */
export async function hasPublicationAttention(
  signal: AbortSignal
): Promise<boolean> {
  let cursor: string | undefined;
  const visited = new Set<string>();
  do {
    const page = await getMySkills(
      { limit: 100, cursor },
      { pluginType: "all", signal }
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (
      page.items.some(
        (item) =>
          item.listingState === "delisted" ||
          item.dependencySuspended ||
          Boolean(item.dependencyIssues?.length) ||
          item.dependencyUpdates?.some((update) => !update.is_skipped)
      )
    )
      return true;
    cursor = page.nextCursor ?? undefined;
    // A malformed repeated cursor cannot prove that the catalog is clear.
    if (cursor && visited.has(cursor))
      throw new Error("Repeated catalog cursor");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return false;
}

export function usePublicationAttention(): boolean {
  const [attention, setAttention] = useState(false);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void hasPublicationAttention(current.signal)
        .then((value) => {
          if (!current.signal.aborted) setAttention(value);
        })
        .catch(() => {
          /* Keep the last known state until a successful read. */
        });
    };
    const reset = () => {
      setAttention(false);
      refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onMenu = ({ menuId }: { menuId: string }) => {
      if (menuId === "mcp-market") refresh();
    };
    const unsubscribe = subscribeReviewsChanged(refresh);
    WKApp.mittBus.on("space-changed", reset);
    WKApp.mittBus.on("wk:auth-state-changed", reset);
    WKApp.mittBus.on("wk:nav-menu-activated", onMenu);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    refresh();
    return () => {
      controller?.abort();
      unsubscribe();
      WKApp.mittBus.off("space-changed", reset);
      WKApp.mittBus.off("wk:auth-state-changed", reset);
      WKApp.mittBus.off("wk:nav-menu-activated", onMenu);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return attention;
}
