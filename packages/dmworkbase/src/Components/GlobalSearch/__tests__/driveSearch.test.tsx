import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// i18n: identity translator so the panel renders without a provider (keys are
// asserted verbatim). Return a STABLE value/`t` reference (like the real
// useMemo-backed provider) — the panel's first-page effect lists `t` in its
// deps, so a fresh `t` per render would re-fire it every render (infinite loop).
vi.mock("../../../i18n", () => {
  const value = { t: (k: string) => k, locale: "en-US" };
  return { useI18n: () => value };
});

import type {
  DriveSearchHit,
  DriveSearchResponse,
  GlobalSearchDataSource,
} from "../../../Service/SearchTypes";
import DriveSearchPanel from "../DriveSearchPanel";

function makeHits(count: number, offset = 0, prefix = "file"): DriveSearchHit[] {
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    return {
      file_id: 1000 + n,
      space_id: "space-1",
      space_name: "共享空间",
      parent_id: 0,
      path: ["设计稿"],
      name: `${prefix}-${n}`,
      type: "doc" as const,
      ext: "md",
      size: 2048,
      owner_uid: "u1",
      owner_name: "Alex",
      updater_uid: "u1",
      updater_name: "Alex",
      created_at: "2026-08-20T10:00:00.000Z",
      updated_at: "2026-08-24T09:30:00.000Z",
    };
  });
}

function makeDataSource(
  impl: (
    query: Parameters<NonNullable<GlobalSearchDataSource["searchDrive"]>>[0]
  ) => Promise<DriveSearchResponse>
): { ds: GlobalSearchDataSource; searchDrive: ReturnType<typeof vi.fn> } {
  const searchDrive = vi.fn(impl);
  return {
    ds: { searchDrive } as unknown as GlobalSearchDataSource,
    searchDrive,
  };
}

function listEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".wk-drive-search__list");
  if (!el) throw new Error("list not rendered");
  return el;
}

describe("DriveSearchPanel — states & interaction", () => {
  it("shows the empty hint and does not search when the keyword is blank", async () => {
    const { ds, searchDrive } = makeDataSource(async () => ({
      total: 0,
      truncated: false,
      items: [],
    }));
    render(<DriveSearchPanel keyword="" dataSource={ds} isActive />);
    expect(
      screen.getByText("base.globalSearch.drive.emptyHint")
    ).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(searchDrive).not.toHaveBeenCalled();
  });

  it("does not search while inactive (hidden panel stays idle)", async () => {
    const { ds, searchDrive } = makeDataSource(async () => ({
      total: 1,
      truncated: false,
      items: makeHits(1),
    }));
    render(<DriveSearchPanel keyword="评审" dataSource={ds} isActive={false} />);
    await new Promise((r) => setTimeout(r, 300));
    expect(searchDrive).not.toHaveBeenCalled();
  });

  it("shows the loading hint while the first page is in flight", async () => {
    const { ds } = makeDataSource(
      () => new Promise<DriveSearchResponse>(() => undefined)
    );
    render(<DriveSearchPanel keyword="评审" dataSource={ds} isActive />);
    expect(
      await screen.findByText("base.globalSearch.drive.loading")
    ).toBeInTheDocument();
  });

  it("renders hits and opens the clicked one via onOpenDriveHit", async () => {
    const hits = makeHits(3);
    const { ds } = makeDataSource(async () => ({
      total: 3,
      truncated: false,
      items: hits,
    }));
    const onOpenDriveHit = vi.fn();
    const { container } = render(
      <DriveSearchPanel
        keyword="评审"
        dataSource={ds}
        isActive
        onOpenDriveHit={onOpenDriveHit}
      />
    );
    await screen.findByText("file-0");
    const first = container.querySelector<HTMLElement>(".wk-drive-search__item");
    fireEvent.click(first!);
    expect(onOpenDriveHit).toHaveBeenCalledWith(hits[0]);
  });

  it("renders backend <mark> highlights as inert <mark> elements (no innerHTML)", async () => {
    const { ds } = makeDataSource(async () => ({
      total: 1,
      truncated: false,
      items: makeHits(1).map((hit) => ({
        ...hit,
        highlights: {
          name: ["需求<mark>评审</mark>纪要"],
          body: ["本次<mark>评审</mark>通过 <script>alert(1)</script>"],
        },
      })),
    }));
    const { container } = render(
      <DriveSearchPanel keyword="评审" dataSource={ds} isActive />
    );
    // Two matches (name + body), so use the findAll variant.
    const marks = await screen.findAllByText("评审", { selector: "mark" });
    expect(marks.length).toBeGreaterThanOrEqual(2);
    // The injected <script> survives as escaped text, never a live element.
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("DriveSearchPanel — offset pagination", () => {
  it("翻页语义: scroll-to-bottom loads page_index+1 and appends the results", async () => {
    const { ds, searchDrive } = makeDataSource(async (query) => ({
      total: 40,
      truncated: false,
      items: makeHits(20, query.page_index === 0 ? 0 : 20),
    }));
    const { container } = render(
      <DriveSearchPanel keyword="评审" dataSource={ds} isActive />
    );
    await screen.findByText("file-0");
    expect(searchDrive.mock.calls[0]![0].page_index).toBe(0);

    // jsdom reports 0 scroll metrics, so any scroll event reads "near bottom".
    // Re-fire until the first page has settled (loading=false) so loadNextPage
    // passes its guard — a real user likewise keeps scrolling once it loads.
    await waitFor(() => {
      fireEvent.scroll(listEl(container));
      expect(searchDrive.mock.calls.length).toBe(2);
    });
    expect(searchDrive.mock.calls[1]![0].page_index).toBe(1);

    // Page 2's hits are appended, not replaced (20 -> 40).
    await waitFor(() =>
      expect(container.querySelectorAll(".wk-drive-search__item").length).toBe(
        40
      )
    );
    expect(screen.getByText("file-20")).toBeInTheDocument();
  });

  it("世代保护: a slow loadNextPage from the previous keyword is discarded after switching", async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const { ds } = makeDataSource(async (query) => {
      if (query.q === "old") {
        if (query.page_index === 0) {
          return { total: 40, truncated: false, items: makeHits(20, 0, "old") };
        }
        await oldGate; // page 1 hangs until we release it (after switching)
        return {
          total: 40,
          truncated: false,
          items: makeHits(20, 20, "old-more"),
        };
      }
      return { total: 4, truncated: false, items: makeHits(4, 0, "new") };
    });

    const { container, rerender } = render(
      <DriveSearchPanel keyword="old" dataSource={ds} isActive />
    );
    await screen.findByText("old-0");
    // Kick off the (hanging) page-2 fetch for "old".
    fireEvent.scroll(listEl(container));

    // Switch keyword while page 2 is still in flight — this bumps the generation.
    rerender(<DriveSearchPanel keyword="new" dataSource={ds} isActive />);
    await screen.findByText("new-0");

    // Now let the stale page-2 resolve; its generation is expired -> dropped.
    releaseOld();
    await oldGate;
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("old-more-20")).toBeNull();
    expect(screen.getByText("new-0")).toBeInTheDocument();
  });

  it("truncated: shows the soft hint and still allows paging", async () => {
    const { ds, searchDrive } = makeDataSource(async (query) => ({
      total: 40,
      truncated: true,
      items: makeHits(20, query.page_index === 0 ? 0 : 20),
    }));
    const { container } = render(
      <DriveSearchPanel keyword="评审" dataSource={ds} isActive />
    );
    await screen.findByText("file-0");
    expect(
      await screen.findByText("base.globalSearch.drive.truncated")
    ).toBeInTheDocument();

    // truncated must NOT gate loadNextPage (hasMore is still true here).
    await waitFor(() => {
      fireEvent.scroll(listEl(container));
      expect(searchDrive.mock.calls.length).toBe(2);
    });
    expect(searchDrive.mock.calls[1]![0].page_index).toBe(1);
  });
});
