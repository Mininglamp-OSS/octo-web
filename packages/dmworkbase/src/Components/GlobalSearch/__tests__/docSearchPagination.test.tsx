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

// DocSearchPanel now paginates by keyset cursor (backend search_after): each
// response carries an opaque `nextCursor` while a further page exists, and the
// panel's stop condition is simply "no nextCursor" — no page/total arithmetic.
// These tests pin that contract:
//   - A response WITH nextCursor keeps the load-more control (more pages).
//   - A response WITHOUT nextCursor stops pagination (final page), even when
//     `total` is larger than the items rendered (total is display-only now).
//   - A late (stale) response from a superseded keyword cannot corrupt the
//     current query's pagination — the hook's requestId guard discards it.

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
  it("keeps the load-more control when the backend returns a nextCursor (more pages)", async () => {
    // jsdom reports all scroll metrics as 0, so the panel's auto-pagination
    // effect always reads "near bottom" and keeps fetching the next page on its
    // own. That is fine for this assertion: as long as every page keeps handing
    // back a nextCursor, `response.hasMore` stays true and the load-more control
    // must remain rendered. Give each page a distinct cursor + fresh rows so the
    // crawl makes forward progress (no duplicate keys) and the button never
    // disappears — the opposite of the terminal-page case covered below.
    let call = 0;
    const dataSource = makeDataSource(async () => {
      call += 1;
      const base = call * 100;
      return {
        total: 1000,
        items: Array.from({ length: PAGE_SIZE }, (_, i) => makeItem(`d${base + i}`)),
        nextCursor: `cursor-${call + 1}`,
      };
    });

    render(<DocSearchPanel keyword="k" dataSource={dataSource} />);

    await screen.findByText("d100");
    const loadMore = await screen.findByRole("button", {
      name: "base.globalSearch.docs.loadMore",
    });
    expect(loadMore).toBeInTheDocument();
  });

  it("stops when the backend omits nextCursor, even if total exceeds the rendered items", async () => {
    // No nextCursor => final page. total is display-only and must NOT resurrect
    // a load-more control on its own.
    const dataSource = makeDataSource(async () => ({
      total: 999,
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
    }));

    const { container } = render(
      <DocSearchPanel keyword="k" dataSource={dataSource} />
    );

    await screen.findByText("a");
    expect(container.querySelector(".wk-doc-search__loadmore")).toBeNull();
  });

  it("sends the previous response's nextCursor back as the cursor on the next page", async () => {
    const searchDocs = vi.fn(async (q: DocSearchQuery) => {
      if (!q.cursor) {
        return {
          total: 40,
          items: Array.from({ length: PAGE_SIZE }, (_, i) => makeItem(`p1_${i}`)),
          nextCursor: "cursor-2",
        };
      }
      return {
        total: 40,
        items: [makeItem("p2_0")],
      };
    });
    const dataSource = { searchDocs } as unknown as GlobalSearchDataSource;

    render(<DocSearchPanel keyword="k" dataSource={dataSource} />);
    // First call: no cursor (first page).
    await screen.findByText("p1_0");
    expect(searchDocs.mock.calls[0]![0].cursor).toBeUndefined();

    // jsdom's zeroed scroll metrics make the panel auto-fetch the next page;
    // whether the second request comes from that or a manual click, it must
    // echo page 1's nextCursor. Wait for it and assert the cursor round-trip.
    await screen.findByText("p2_0");
    expect(searchDocs.mock.calls[1]![0].cursor).toBe("cursor-2");
  });

  it("keyword change: a late (stale) response from the previous query cannot corrupt the new query's pagination", async () => {
    // Reproduce the stale-response race directly. Keyword "old" resolves LATE
    // (deferred) as a full page WITH a nextCursor; keyword "new" resolves
    // immediately as a genuine final page (no nextCursor). The hook's requestId
    // guard must discard the late "old" resolution so it neither leaks its items
    // nor re-arms the load-more control on the "new" query.
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
          nextCursor: "old-cursor-2",
        };
      }
      return {
        total: 4,
        items: Array.from({ length: 4 }, (_, i) => makeItem(`n${i}`)),
      };
    });

    const { rerender } = render(
      <DocSearchPanel keyword="old" dataSource={dataSource} />
    );
    // The "old" first request must actually have fired before we supersede it —
    // otherwise this would be a no-op shell, not a real stale-response test.
    await vi.waitFor(() =>
      expect(
        (dataSource.searchDocs as unknown as ReturnType<typeof vi.fn>).mock.calls
          .length
      ).toBeGreaterThan(0)
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
  // coerces stray values to plausible-millis-or-null. The panel's formatUpdatedAt
  // must render "" for null (early return on falsy) and a date for valid millis,
  // never an "Invalid Date".
  function itemWith(updatedAt: number | null): DocSearchItem {
    return { docId: "x1", title: "hello-doc", docType: "doc", updatedAt };
  }

  it("renders an empty sub line when updatedAt is null", async () => {
    const dataSource = makeDataSource(async () => ({
      total: 1,
      items: [itemWith(null)],
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
