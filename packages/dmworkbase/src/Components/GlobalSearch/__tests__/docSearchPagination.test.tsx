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

// The pagination stop condition (DocSearchPanel's searchPage) went through
// several revisions to close reachable "hasMore flips false while results
// remain" defects:
//   - A client-side docId filter can shrink a full page; full-page detection
//     must use the backend's pre-filter count (rawItemCount), not
//     items.length, or a full page reads as short and stops early.
//   - The accumulated page count must not live in a cross-render mutable ref
//     that a discarded (stale) response could still mutate ahead of the
//     hook's request-id guard. It is now derived purely from the current
//     request's own `page * PAGE_SIZE` versus the server total, so a stale
//     response can never poison a fresh query's pagination.
//
// These tests pin those invariants so a future rewrite can't silently
// regress them.

const PAGE_SIZE = 20;

function makeItem(id: string): DocSearchItem {
  return { docId: id, title: id, docType: "doc", updatedAt: 0 };
}

function makeDataSource(
  impl: (q: DocSearchQuery) => Promise<DocSearchResponse>
): GlobalSearchDataSource {
  return { searchDocs: vi.fn(impl) } as unknown as GlobalSearchDataSource;
}

describe("DocSearchPanel — pagination stop conditions", () => {
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

  it("keyword change: a late (stale) response from the previous query cannot corrupt the new query's pagination", async () => {
    // Reproduce the P1 race directly. Keyword "old" resolves LATE (deferred),
    // keyword "new" resolves immediately as a genuine short final page. If the
    // stop condition depended on a shared mutable accumulator, the late "old"
    // resolution would still bump it and could push the "new" query's hasMore
    // false. With `page * PAGE_SIZE` derivation, the stale resolution is inert.
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });

    const dataSource = makeDataSource(async (q) => {
      if (q.keyword === "old") {
        await oldGate; // resolves only after we switch to "new"
        return {
          total: 1000,
          items: Array.from({ length: PAGE_SIZE }, (_, i) => makeItem(`o${i}`)),
          rawItemCount: PAGE_SIZE,
        };
      }
      return {
        total: 4,
        items: Array.from({ length: 4 }, (_, i) => makeItem(`n${i}`)),
        rawItemCount: 4,
      };
    });

    const { rerender } = render(
      <DocSearchPanel keyword="old" dataSource={dataSource} />
    );
    // Switch to "new" while "old" is still in flight.
    rerender(<DocSearchPanel keyword="new" dataSource={dataSource} />);
    await screen.findByText("n0");

    // Now let the stale "old" request resolve.
    releaseOld();
    await oldGate;
    // Give React a tick to (not) apply the discarded response.
    await new Promise((r) => setTimeout(r, 50));

    // The "new" query is a genuine 4-item final page: no load-more, and the
    // stale "old" full page must not have leaked in.
    expect(document.body.querySelector(".wk-doc-search__loadmore")).toBeNull();
    expect(screen.queryByText("o0")).toBeNull();
    expect(screen.getByText("n0")).toBeInTheDocument();
  });
});

describe("DocSearchPanel — updatedAt rendering (contract: number | null)", () => {
  // The backend returns updatedAt as `number | null` epoch millis; SearchService
  // coerces stray values to positive-millis-or-null. The panel's formatUpdatedAt
  // must render "" for null (early return on falsy) and a date for valid millis,
  // never an "Invalid Date".
  function itemWith(updatedAt: number | null): DocSearchItem {
    return { docId: "x1", title: "hello-doc", docType: "doc", updatedAt };
  }

  it("renders an empty sub line when updatedAt is null", async () => {
    const dataSource = makeDataSource(async () => ({
      total: 1,
      items: [itemWith(null)],
      rawItemCount: 1,
    }));
    const { container } = render(
      <DocSearchPanel keyword="k" dataSource={dataSource} />
    );
    await screen.findByText("hello-doc");
    const sub = container.querySelector(".wk-doc-search__sub");
    expect(sub).not.toBeNull();
    expect(sub?.textContent).toBe("");
  });

  it("renders a date (not Invalid Date) for valid epoch millis", async () => {
    const millis = Date.UTC(2024, 0, 15, 12, 0, 0); // 2024-01-15
    const dataSource = makeDataSource(async () => ({
      total: 1,
      items: [itemWith(millis)],
      rawItemCount: 1,
    }));
    const { container } = render(
      <DocSearchPanel keyword="k" dataSource={dataSource} />
    );
    await screen.findByText("hello-doc");
    const sub = container.querySelector(".wk-doc-search__sub");
    expect(sub?.textContent).toBe(new Date(millis).toLocaleDateString("en-US"));
    expect(sub?.textContent).not.toContain("Invalid");
    expect(sub?.textContent).not.toBe("");
  });
});
