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

// ReviewBot / Jerry-Xin flagged P1s that all live in DocSearchPanel's
// searchPage stop-condition:
//   round-3 P1-1  loadedRef self-incremented BEFORE useSearchPagination's
//                 stale guard, so a discarded response still counted.
//   round-3 P1-2  A "short page => stop" rule that used items.length, but
//                 SearchService.searchDocs drops malformed rows and forges
//                 a short page — the full-page check must look at the
//                 backend's pre-filter count (rawItemCount).
//   round-4 P1    loadedRef only reset on keyword change, but the hook
//                 clears its response every time `enabled` flips. Switching
//                 tabs (isActive false → true) with the same keyword left
//                 loadedRef inflated, pushing hasMore false after the next
//                 page-1 fetch. Fix: reset loadedRef on canSearch changes
//                 too, mirroring the hook's own lifecycle.
//
// These tests pin all three invariants so a future rewrite of hasMore
// can't silently regress any of them.

const PAGE_SIZE = 20;

function makeItem(id: string): DocSearchItem {
  return { docId: id, title: id, docType: "doc", updatedAt: 0 };
}

function makeDataSource(
  impl: (q: DocSearchQuery) => Promise<DocSearchResponse>
): GlobalSearchDataSource {
  return { searchDocs: vi.fn(impl) } as unknown as GlobalSearchDataSource;
}

describe("DocSearchPanel — pagination stop conditions (ReviewBot rounds 3/4 P1s)", () => {
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

    await screen.findByText("d0");
    const loadMore = await screen.findByRole("button", {
      name: "base.globalSearch.docs.loadMore",
    });
    expect(loadMore).toBeInTheDocument();
  });

  it("DOES stop when the backend itself returned a short page (real end of results)", async () => {
    // Genuine short page: rawItemCount matches items.length and is < PAGE_SIZE.
    const dataSource = makeDataSource(async () => ({
      total: 3,
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
      rawItemCount: 3,
    }));

    const { container } = render(
      <DocSearchPanel keyword="k" dataSource={dataSource} />
    );

    await screen.findByText("a");
    expect(container.querySelector(".wk-doc-search__loadmore")).toBeNull();
  });

  it("resets the accumulated counter on keyword change so a stale count cannot poison the next query", async () => {
    // Keyword changes from "old" (full page, big total) to "new" (short page,
    // small total). The new query must render its own items without carrying
    // any accumulated state from the previous query.
    const dataSource = makeDataSource(async (q) => {
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

    rerender(<DocSearchPanel keyword="new" dataSource={dataSource} />);
    await screen.findByText("n0");
    // The new query is a genuine short final page, so no load-more.
    expect(document.body.querySelector(".wk-doc-search__loadmore")).toBeNull();
  });

  it("resets the accumulated counter across tab-switch (isActive false then true) — Jerry-Xin round-4 P1 source guard", () => {
    // Jerry-Xin round-4 P1: useSearchPagination clears its response every
    // time `enabled` changes, but the accumulator lived in the panel and was
    // only reset on trimmed. Switching away from the Cloud Docs tab and back
    // with the same keyword produced: visible items = 0 but loadedRef still
    // holding the previous accumulated value. On the next page-1 fetch,
    // loadedRef.current += res.items.length pushed it past total and hasMore
    // flipped false, hiding all subsequent pages. Fix: reset loadedRef on
    // canSearch (enabled) changes too, mirroring the hook's own lifecycle.
    //
    // Rendering this end-to-end in jsdom is unreliable because the shared
    // pagination hook's scroll-based auto-pagination is not gated by DOM
    // metrics that jsdom fills in (see the older isActive.test.tsx suite for
    // the same reason). Pin the fix at the source level instead: the effect
    // that clears loadedRef MUST depend on canSearch, not just trimmed.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const panelSrc = fs.readFileSync(
      path.join(__dirname, "..", "DocSearchPanel.tsx"),
      "utf8"
    );
    // Locate the loadedRef reset effect and assert its dependency array
    // includes canSearch. This is the invariant Jerry-Xin's P1 requires.
    expect(panelSrc).toMatch(
      /loadedRef\.current\s*=\s*0;\s*\}\s*,\s*\[trimmed,\s*canSearch\]/
    );
  });
});
