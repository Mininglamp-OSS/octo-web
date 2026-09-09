// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertItem } from "../mock/expertMock";
import type { ExpertListResult, ListExpertParams } from "../api/expertService";

const api = vi.hoisted(() => ({
  listExperts: vi.fn(),
  listSquads: vi.fn(),
  listMyExperts: vi.fn(),
  listMySquads: vi.fn(),
  listExpertCategories: vi.fn(),
  listExpertTags: vi.fn(),
  clearLoopCache: vi.fn(),
  prefetchLoopTargets: vi.fn(),
  deleteExpert: vi.fn(),
  deleteSquad: vi.fn(),
  getExpert: vi.fn(),
  getSquad: vi.fn(),
}));
const bus = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }));
vi.mock("../api/expertService", () => api);
vi.mock("@octo/base", () => ({
  WKApp: { mittBus: bus },
  useI18n: () => undefined,
  t: (key: string, options?: { values?: Record<string, unknown> }) =>
    options?.values ? `${key}:${JSON.stringify(options.values)}` : key,
  WKButton: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: vi.fn() },
  Tooltip: () => null,
}));
vi.mock("@dmwork/skillmarket", () => ({
  MineTable: ({ rows }: { rows: { id: string; name: string }[] }) => (
    <div>
      {rows.map((row) => (
        <div data-item={row.id} key={row.id}>
          {row.name}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../components/ExpertCard", () => ({
  default: ({ item }: { item: ExpertItem }) => (
    <div data-item={item.id}>{item.name}</div>
  ),
}));
vi.mock("../components/ExpertDetailModal", () => ({ default: () => null }));
vi.mock("../components/ExpertBotPublishModal", () => ({ default: () => null }));
vi.mock("../components/ExpertDeleteConfirmModal", () => ({
  default: () => null,
}));
vi.mock("../components/ExpertAddToLoopModal", () => ({ default: () => null }));

import ExpertMarketListPage from "./ExpertMarketListPage";
import { EXPERT_CATEGORIES } from "../mock/expertMock";

const records: ExpertItem[] = Array.from({ length: 112 }, (_, i) => ({
  id: `expert-${i + 1}`,
  kind: "agent",
  shortName: "E",
  name:
    i === 65
      ? "数据分析报告专家"
      : i === 111
      ? "数据分析报告师"
      : `Expert ${i + 1}`,
  summary: "Summary-only term",
  category: i === 111 ? "Reports" : "General",
  tags: i === 111 ? ["rare", "analysis"] : ["common"],
  publisher: "Octo",
  creatorName: "Owner",
  createdByType: "human",
}));

function serverList(params: ListExpertParams = {}): Promise<ExpertListResult> {
  const filtered = records.filter(
    (item) =>
      (!params.keyword ||
        item.name.toLowerCase().includes(params.keyword.toLowerCase())) &&
      (!params.category ||
        params.category === EXPERT_CATEGORIES[0] ||
        item.category === params.category) &&
      (!params.tags?.length ||
        params.tags.every((tag) => item.tags.includes(tag)))
  );
  const start = ((params.page ?? 1) - 1) * (params.pageSize ?? 100);
  return Promise.resolve({
    items: filtered.slice(start, start + (params.pageSize ?? 100)),
    total: filtered.length,
  });
}

let root: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  for (const list of [
    api.listExperts,
    api.listSquads,
    api.listMyExperts,
    api.listMySquads,
  ]) {
    list.mockImplementation(serverList);
  }
  api.listExpertCategories.mockResolvedValue([
    { name: "Reports", count: 1 },
    { name: "General", count: 111 },
  ]);
  api.listExpertTags.mockResolvedValue(["common", "rare", "analysis"]);
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(root);
  });
  root.remove();
  vi.useRealTimers();
});

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function render(
  props: React.ComponentProps<typeof ExpertMarketListPage> = {}
) {
  act(() => {
    ReactDOM.render(<ExpertMarketListPage {...props} />, root);
  });
  await tick();
}
function button(label: string, parent: ParentNode = root) {
  const found = Array.from(parent.querySelectorAll("button")).find(
    (el) => el.textContent === label
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function click(el: Element) {
  act(() => {
    Simulate.click(el);
  });
}
function search(value: string) {
  act(() => {
    Simulate.change(root.querySelector('input[type="search"]')!, {
      target: { value },
    } as never);
  });
}
function itemCount() {
  return root.querySelectorAll("[data-item]").length;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("expert catalog server search and pagination", () => {
  it("searches tags beyond the suggestion limit without reloading rows and retains selected tags", async () => {
    const tags = [...Array.from({ length: 50 }, (_, i) => `tag-${i}`), "rare"];
    api.listExpertTags.mockImplementation((_kind, options) =>
      Promise.resolve(
        tags
          .filter((tag) => !options.keyword || tag.includes(options.keyword))
          .slice(0, 50)
      )
    );
    await render();
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(50);
    const input = root.querySelector(
      '[aria-label="mcp.expert.tagSearchPlaceholder"]'
    )!;
    act(() => {
      Simulate.change(input, { target: { value: "rare" } } as never);
    });
    expect(itemCount()).toBe(100);
    await tick(250);
    expect(api.listExpertTags).toHaveBeenLastCalledWith("agent", {
      mine: false,
      keyword: "rare",
    });
    expect(api.listExperts).toHaveBeenCalledTimes(1);
    click(button("rare"));
    await tick();
    act(() => {
      Simulate.change(input, { target: { value: "" } } as never);
    });
    await tick();
    expect(button("rare").getAttribute("aria-selected")).toBe("true");
    expect(itemCount()).toBe(1);
  });

  it("keeps rows usable when tag suggestions fail and retries only the tags", async () => {
    api.listExpertTags.mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(itemCount()).toBe(100);
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    click(button("mcp.list.retry"));
    await tick();
    expect(button("rare")).toBeTruthy();
    expect(api.listExperts).toHaveBeenCalledTimes(1);
  });

  it("ignores late tag search responses after a new search and a Space switch", async () => {
    await render();
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    const input = root.querySelector(
      '[aria-label="mcp.expert.tagSearchPlaceholder"]'
    )!;
    const old = deferred<string[]>();
    api.listExpertTags.mockReturnValueOnce(old.promise);
    act(() => {
      Simulate.change(input, { target: { value: "old" } } as never);
    });
    await tick(250);
    act(() => {
      Simulate.change(input, { target: { value: "rare" } } as never);
    });
    await tick(250);
    await act(async () => {
      old.resolve(["old"]);
    });
    expect(button("rare")).toBeTruthy();
    const stale = deferred<string[]>();
    api.listExpertTags.mockReturnValueOnce(stale.promise);
    act(() => {
      Simulate.change(input, { target: { value: "stale" } } as never);
    });
    await tick(250);
    const spaceChanged = bus.on.mock.calls.find(
      ([event]) => event === "space-changed"
    )![1];
    act(() => {
      spaceChanged();
    });
    await tick();
    await act(async () => {
      stale.resolve(["stale"]);
    });
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    expect(root.querySelector('[title="stale"]')).toBeNull();
    expect(button("rare")).toBeTruthy();
  });

  it("limits AND-combined filters to 20 tags while allowing deselection", async () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    api.listExpertTags.mockResolvedValue(tags);
    await render();
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    for (const tag of tags.slice(0, 20)) click(button(tag));
    await tick();
    expect(button(tags[20]).disabled).toBe(true);
    expect(root.textContent).toContain("mcp.expert.tagLimit");
    expect(api.listExperts.mock.calls.at(-1)![0].tags).toHaveLength(20);
    click(button(tags[0]));
    expect(button(tags[20]).disabled).toBe(false);
  });

  it("finds both production-example matches at positions 66 and 112 without loading page 2", async () => {
    await render();
    expect(itemCount()).toBe(100);
    expect(root.textContent).not.toContain("数据分析报告师");
    search("数据分析");
    search("数据分析报告");
    await tick(249);
    expect(api.listExperts).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(api.listExperts).toHaveBeenCalledTimes(2);
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keyword: "数据分析报告",
        page: 1,
        pageSize: 100,
      })
    );
    expect(itemCount()).toBe(2);
    expect(root.textContent).toContain("数据分析报告专家");
    expect(root.textContent).toContain("数据分析报告师");
    expect(
      root.querySelectorAll(".wk-mcp-expert-category__count")
    ).toHaveLength(0);
    expect(root.textContent).toContain('"total":2');
    expect(root.textContent).not.toContain("mcp.expert.loadMore");
  });

  it("loads the remaining records once, then resets paging for search and clear", async () => {
    await render();
    const more = button("mcp.expert.loadMore");
    act(() => {
      Simulate.click(more);
      Simulate.click(more);
    });
    await tick();
    expect(api.listExperts).toHaveBeenCalledTimes(2);
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    );
    expect(itemCount()).toBe(112);
    expect(root.textContent).not.toContain("mcp.expert.loadMore");
    search("数据分析报告");
    await tick(250);
    expect(itemCount()).toBe(2);
    click(root.querySelector('[aria-label="mcp.expert.searchClear"]')!);
    await tick();
    expect(itemCount()).toBe(100);
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  it("filters a category and tags found only beyond page 1, and forwards sort", async () => {
    await render();
    click(
      Array.from(root.querySelectorAll(".wk-mcp-expert-category")).find(
        (el) => el.textContent === "Reports1"
      )!
    );
    await tick();
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "Reports", page: 1 })
    );
    expect(itemCount()).toBe(1);
    click(root.querySelector('[aria-haspopup="listbox"]')!);
    click(button("rare"));
    await tick();
    click(button("analysis"));
    await tick();
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: ["analysis", "rare"], page: 1 })
    );
    expect(root.textContent).toContain("数据分析报告师");
    click(button("mcp.expert.sortHottest"));
    await tick();
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "installs", page: 1 })
    );
  });

  it("keeps previous rows on a later-page failure and retries the same page", async () => {
    await render();
    api.listExperts.mockRejectedValueOnce(new Error("offline"));
    click(button("mcp.expert.loadMore"));
    await tick();
    expect(itemCount()).toBe(100);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    click(button("mcp.list.retry"));
    await tick();
    expect(api.listExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    );
    expect(itemCount()).toBe(112);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("retries an initial failure using the current search", async () => {
    api.listExperts.mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(itemCount()).toBe(0);
    click(button("mcp.list.retry"));
    await tick();
    expect(itemCount()).toBe(100);
    search("summary-only");
    await tick(250);
    expect(itemCount()).toBe(0);
    expect(root.textContent).toContain("mcp.expert.empty");
  });

  it("ignores an old page response after the keyword changes", async () => {
    await render();
    const old = deferred<ExpertListResult>();
    api.listExperts.mockReturnValueOnce(old.promise);
    click(button("mcp.expert.loadMore"));
    search("数据分析报告");
    await tick(250);
    await act(async () => {
      old.resolve({ items: records.slice(100), total: 112 });
    });
    expect(itemCount()).toBe(2);
    expect(root.textContent).not.toContain("Expert 101");
  });

  it("clears filters on kind change and ignores a slow old search", async () => {
    await render();
    const old = deferred<ExpertListResult>();
    api.listExperts.mockReturnValueOnce(old.promise);
    search("数据分析报告");
    await tick(250);
    click(button("mcp.expert.typeSquad"));
    await tick(250);
    expect(api.listSquads).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: "数据分析报告", tags: [], page: 1 })
    );
    await act(async () => {
      old.resolve({ items: records, total: 112 });
    });
    expect(itemCount()).toBe(2);
  });

  it("reloads on Space changes with empty filters and ignores old-Space pages", async () => {
    await render();
    const old = deferred<ExpertListResult>();
    api.listExperts.mockReturnValueOnce(old.promise);
    click(button("mcp.expert.loadMore"));
    api.listExperts.mockResolvedValueOnce({ items: [], total: 0 });
    const spaceChanged = bus.on.mock.calls.find(
      ([event]) => event === "space-changed"
    )![1];
    act(() => {
      spaceChanged();
    });
    expect(itemCount()).toBe(0);
    await tick();
    await act(async () => {
      old.resolve({ items: records.slice(100), total: 112 });
    });
    expect(itemCount()).toBe(0);
    expect(root.textContent).not.toContain("mcp.expert.loadMore");
    expect(api.clearLoopCache).toHaveBeenCalledOnce();
  });

  it("deduplicates overlapping pages and stops on an empty end page", async () => {
    await render();
    api.listExperts.mockResolvedValueOnce({
      items: records.slice(99),
      total: 250,
    });
    click(button("mcp.expert.loadMore"));
    await tick();
    expect(itemCount()).toBe(112);
    api.listExperts.mockResolvedValueOnce({ items: [], total: 250 });
    click(button("mcp.expert.loadMore"));
    await tick();
    expect(root.textContent).not.toContain("mcp.expert.loadMore");
  });

  it("paginates mine sections independently and searches both on the server", async () => {
    await render({ variant: "mine" });
    expect(api.listExperts).not.toHaveBeenCalled();
    expect(api.listSquads).not.toHaveBeenCalled();
    expect(itemCount()).toBe(200);
    expect(api.listExpertTags).toHaveBeenCalledWith("agent", { mine: true });
    expect(api.listExpertTags).toHaveBeenCalledWith("squad", { mine: true });
    const sections = root.querySelectorAll(".wk-mcp-expert-mine-section");
    click(button("mcp.expert.loadMore", sections[0]));
    await tick();
    expect(sections[0].querySelectorAll("[data-item]")).toHaveLength(112);
    expect(sections[1].querySelectorAll("[data-item]")).toHaveLength(100);
    expect(api.listMyExperts).toHaveBeenCalledTimes(1);
    search("数据分析报告");
    await tick(250);
    expect(itemCount()).toBe(4);
    for (const list of [api.listMyExperts, api.listMySquads]) {
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: "数据分析报告", page: 1 })
      );
    }
  });

  it.each(["agent", "squad"] as const)(
    "only loads the selected personal %s type",
    async (mineType) => {
      await render({ variant: "mine", mineType });
      expect(
        mineType === "agent" ? api.listMySquads : api.listMyExperts
      ).not.toHaveBeenCalled();
      expect(itemCount()).toBe(100);
    }
  );

  it("cancels pending debounced searches on unmount", async () => {
    await render();
    search("later");
    act(() => {
      ReactDOM.unmountComponentAtNode(root);
    });
    await tick(250);
    expect(api.listExperts).toHaveBeenCalledTimes(1);
    expect(bus.off).toHaveBeenCalledWith("space-changed", expect.any(Function));
  });
});
