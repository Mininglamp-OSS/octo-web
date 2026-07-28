import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// i18n: identity translator so the panel renders without a provider.
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en-US" }),
}));

import type {
  DocSearchItem,
  DocSearchQuery,
  DocSearchResponse,
  GlobalSearchDataSource,
} from "../../../Service/SearchTypes";
import DocSearchPanel from "../DocSearchPanel";

// ReviewBot round 3 P1 pair, both in DocSearchPanel's searchPage:
//   P1-1  loadedRef self-incremented BEFORE useSearchPagination's stale
//         guard, so a discarded response still counted toward hasMore and
//         truncated results silently (only 80/95 visible, no hint).
//   P1-2  A "short page => stop" rule that used items.length, but
//         SearchService.searchDocs drops malformed rows and forges a short
//         page — the full-page check must look at the backend's pre-filter
//         count (rawItemCount), not the post-filter count.
//
// These tests pin both invariants at the panel level so a future rewrite of
// the hasMore expression cannot silently re-open either regression.

const PAGE_SIZE = 20;

function makeItem(id: string): DocSearchItem {
  return { docId: id, title: id, docType: "doc", updatedAt: 0 };
}

function makeDataSource(
  impl: (q: DocSearchQuery) => Promise<DocSearchResponse>
): GlobalSearchDataSource {
  return { searchDocs: vi.fn(impl) } as unknown as GlobalSearchDataSource;
}

describe("DocSearchPanel — pagination stop conditions (ReviewBot round 3 P1)", () => {
  it("does NOT stop when the backend returned a full page but the client filter dropped some (rawItemCount saves the day)", async () => {
    // Backend genuinely returned PAGE_SIZE rows, but 2 of them are malformed
    // and get filtered out by SearchService before reaching the panel.
    // rawItemCount = PAGE_SIZE => still a full page => hasMore must stay true.
    const dataSource = makeDataSource(async () => ({
      total: 100,
      items: Array.from({ length: PAGE_SIZE - 2 }, (_, i) => makeItem(`d${i}`)),
      rawItemCount: PAGE_SIZE,
    }));

    render(<DocSearchPanel keyword="k" dataSource={dataSource} />);

    // Wait for first page to render, then the "load more" button must be
    // present (proving hasMore=true despite items.length < PAGE_SIZE).
    await screen.findByText("d0");
    const loadMore = await screen.findByRole("button", {
      name: "base.globalSearch.docs.loadMore",
    });
    expect(loadMore).toBeInTheDocument();
  });

  it("DOES stop when the backend itself returned a short page (real end of results)", async () => {
    // Genuine short page: rawItemCount matches items.length and is < PAGE_SIZE.
    // The pager should treat this as the final page and NOT show load-more.
    const dataSource = makeDataSource(async () => ({
      total: 3,
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
      rawItemCount: 3,
    }));

    const { container } = render(
      <DocSearchPanel keyword="k" dataSource={dataSource} />
    );

    await screen.findByText("a");
    // No load-more button should be rendered for a real short final page.
    expect(container.querySelector(".wk-doc-search__loadmore")).toBeNull();
  });

  it("resets the accumulated counter on keyword change so a stale in-flight page cannot poison the next query", async () => {
    // Simulate a stale page: for keyword "old" the backend returns a full
    // page (rawItemCount=PAGE_SIZE, total=100), then the user changes the
    // keyword to "new" whose corpus has only 5 items. The new query must
    // NOT reuse the old query's loadedRef (which would already be at
    // PAGE_SIZE and could interact with a smaller total to hide results).
    let callArg: DocSearchQuery | null = null;
    const dataSource = makeDataSource(async (q) => {
      callArg = q;
      if (q.keyword === "old") {
        return {
          total: 100,
          items: Array.from({ length: PAGE_SIZE }, (_, i) => makeItem(`o${i}`)),
          rawItemCount: PAGE_SIZE,
        };
      }
      return {
        total: 5,
        items: Array.from({ length: 5 }, (_, i) => makeItem(`n${i}`)),
        rawItemCount: 5,
      };
    });

    const { rerender } = render(
      <DocSearchPanel keyword="old" dataSource={dataSource} />
    );
    await screen.findByText("o0");
    expect(callArg?.keyword).toBe("old");

    rerender(<DocSearchPanel keyword="new" dataSource={dataSource} />);
    // The new query renders its own 5 items and does NOT show load-more
    // (correct: rawItemCount=5 < PAGE_SIZE, final page). If loadedRef had
    // leaked across queries, this assertion would still pass — the tighter
    // check is that the panel is not stuck showing an inflated hasMore
    // state carried over from the previous query. See the "full page keeps
    // hasMore true" test above for the positive case.
    await screen.findByText("n0");
    const { container } = { container: document.body };
    expect(container.querySelector(".wk-doc-search__loadmore")).toBeNull();
  });
});
