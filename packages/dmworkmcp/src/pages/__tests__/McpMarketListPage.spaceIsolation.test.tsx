// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchMcpDetail: vi.fn(),
  fetchMcpList: vi.fn(),
  fetchMcpMine: vi.fn(),
  fetchMcpTags: vi.fn(),
  toastError: vi.fn(),
  app: { currentSpaceId: "space-a" },
}));

vi.mock("@octo/base", () => ({
  I18nContext: React.createContext(undefined),
  t: (key: string) => key,
  WKApp: { shared: h.app, mittBus: { on: vi.fn(), off: vi.fn() } },
  WKButton: () => null,
  Dap: { track: vi.fn() },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => null,
  Toast: { error: h.toastError },
}));
vi.mock("@douyinfe/semi-icons", () => ({ IconClose: () => null }));
vi.mock("lucide-react", () => ({
  Bot: () => null,
  Check: () => null,
  ChevronDown: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  Upload: () => null,
}));
vi.mock("@dmwork/skillmarket", () => ({
  MineTable: () => null,
}));
vi.mock("../../api/mcpService", () => ({
  fetchMcpDetail: (...args: unknown[]) => h.fetchMcpDetail(...args),
  fetchMcpList: (...args: unknown[]) => h.fetchMcpList(...args),
  fetchMcpMine: (...args: unknown[]) => h.fetchMcpMine(...args),
  fetchMcpTags: (...args: unknown[]) => h.fetchMcpTags(...args),
}));
vi.mock("../../api/pluginReview", () => ({
  cancelPluginReview: vi.fn(),
  publishPluginListing: vi.fn(),
}));
vi.mock("../../hooks/useMyReviewState", () => ({
  MyReviewStateProbe: () => null,
  resolveReviewRowState: vi.fn(),
}));
vi.mock("../../components/McpCard", () => ({ default: () => null }));
vi.mock("../../components/McpDetailModal", () => ({ default: () => null }));
vi.mock("../../components/McpCreateModal", () => ({ default: () => null }));
vi.mock("../../components/McpBotPublishModal", () => ({ default: () => null }));
vi.mock("../../components/McpConnectModal", () => ({ default: () => null }));
vi.mock("../../components/McpDeleteConfirmModal", () => ({ default: () => null }));
vi.mock("../../components/ReviewSubmitModal", () => ({ default: () => null }));

import McpMarketListPage from "../McpMarketListPage";

type PageInternals = {
  state: Record<string, unknown>;
  setState: (
    patch:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
    callback?: () => void
  ) => void;
  loadData: () => Promise<void>;
  handleEditFromCard: (item: { id: string }) => Promise<void>;
  openPublishVersion: (item: { id: string }) => Promise<void>;
  handleSpaceChanged_: () => void;
  componentDidMount: () => void;
  componentWillUnmount: () => void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createPage(): PageInternals {
  const page = new McpMarketListPage({}) as unknown as PageInternals;
  page.setState = (patch, callback) => {
    const next = typeof patch === "function" ? patch(page.state) : patch;
    page.state = { ...page.state, ...next };
    callback?.();
  };
  page.componentDidMount();
  return page;
}

function createUnmountedPage(): PageInternals {
  const page = new McpMarketListPage({}) as unknown as PageInternals;
  page.setState = (patch, callback) => {
    const next = typeof patch === "function" ? patch(page.state) : patch;
    page.state = { ...page.state, ...next };
    callback?.();
  };
  return page;
}

const item = { id: "space-a-plugin" };
const detail = { id: item.id, name: "Space A connector" };

beforeEach(() => {
  vi.resetAllMocks();
  h.app.currentSpaceId = "space-a";
  const emptyList = {
    items: [],
    categories: [{ key: "all", label: "全部", count: 0 }],
    total: 0,
  };
  h.fetchMcpList.mockResolvedValue(emptyList);
  h.fetchMcpMine.mockResolvedValue(emptyList);
  h.fetchMcpTags.mockResolvedValue([]);
});

describe("McpMarketListPage category reset contract", () => {
  it("keeps the selected category when taxonomy degrades to the All pill only", async () => {
    const page = createUnmountedPage();
    page.state = {
      ...page.state,
      mode: "all",
      categoriesSelected: ["dev"],
    };
    h.fetchMcpList.mockResolvedValueOnce({
      items: [],
      categories: [{ key: "all", label: "全部", count: 0 }],
      total: 0,
    });

    await page.loadData();

    expect(h.fetchMcpList).toHaveBeenCalledOnce();
    expect(page.state.categoriesSelected).toEqual(["dev"]);
    expect(page.state.loading).toBe(false);
  });

  it("resets a selected category only after a resolved taxonomy omits it", async () => {
    const page = createUnmountedPage();
    page.state = {
      ...page.state,
      mode: "all",
      categoriesSelected: ["dev"],
    };
    const secondLoad = deferred<{
      items: unknown[];
      categories: Array<{ key: string; label: string; count: number }>;
      total: number;
    }>();
    h.fetchMcpList
      .mockResolvedValueOnce({
        items: [],
        categories: [
          { key: "all", label: "全部", count: 1 },
          { key: "data", label: "Data", count: 1 },
        ],
        total: 0,
      })
      .mockReturnValueOnce(secondLoad.promise);

    await page.loadData();

    expect(h.fetchMcpList).toHaveBeenCalledTimes(2);
    expect(h.fetchMcpList.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ categories: [] })
    );
    expect(page.state.categoriesSelected).toEqual([]);
    expect(page.state.loading).toBe(true);

    secondLoad.resolve({
      items: [{ id: "data-plugin" }],
      categories: [
        { key: "all", label: "全部", count: 1 },
        { key: "data", label: "Data", count: 1 },
      ],
      total: 1,
    });
    await Promise.resolve();

    expect(page.state.loading).toBe(false);
    expect(page.state.items).toEqual([{ id: "data-plugin" }]);
  });
});

describe("McpMarketListPage detail continuation Space isolation", () => {

  it.each([
    ["card edit", (page: PageInternals) => page.handleEditFromCard(item)],
    ["publish version", (page: PageInternals) => page.openPublishVersion(item)],
  ])("does not reopen the %s modal when its old-Space detail fetch resolves", async (_label, start) => {
    const pending = deferred<typeof detail>();
    h.fetchMcpDetail.mockReturnValueOnce(pending.promise);
    const page = createPage();

    const action = start(page);
    page.handleSpaceChanged_();
    pending.resolve(detail);
    await action;

    expect(page.state.createVisible).toBe(false);
    expect(page.state.editingDetail).toBeNull();
    expect(page.state.reviewEditingDetail).toBeNull();
  });

  it.each([
    ["card edit", (page: PageInternals) => page.handleEditFromCard(item)],
    ["publish version", (page: PageInternals) => page.openPublishVersion(item)],
  ])("does not toast the %s failure after switching Space", async (_label, start) => {
    const pending = deferred<typeof detail>();
    h.fetchMcpDetail.mockReturnValueOnce(pending.promise);
    const page = createPage();

    const action = start(page);
    page.handleSpaceChanged_();
    pending.reject(new Error("old Space failure"));
    await action;

    expect(h.toastError).not.toHaveBeenCalled();
  });
});

const detailActions = [
  ["card edit", "editingDetail", (page: PageInternals, target = item) => page.handleEditFromCard(target)],
  ["publish version", "reviewEditingDetail", (page: PageInternals, target = item) => page.openPublishVersion(target)],
] as const;

describe.each(detailActions)("McpMarketListPage %s detail lifecycle", (_label, detailKey, start) => {
  it.each(["resolve", "reject"] as const)("ignores a %s after unmount", async (outcome) => {
    const pending = deferred<typeof detail>();
    h.fetchMcpDetail.mockReturnValueOnce(pending.promise);
    const page = createPage();
    const action = start(page);
    page.componentWillUnmount();
    if (outcome === "resolve") pending.resolve(detail);
    else pending.reject(new Error("unmounted failure"));
    await action;

    expect(page.state.createVisible).toBe(false);
    expect(page.state[detailKey]).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores a %s after Space changes without an event", async (outcome) => {
    const pending = deferred<typeof detail>();
    h.fetchMcpDetail.mockReturnValueOnce(pending.promise);
    const page = createPage();
    const action = start(page);
    h.app.currentSpaceId = "space-b";
    if (outcome === "resolve") pending.resolve(detail);
    else pending.reject(new Error("old Space failure"));
    await action;

    expect(page.state.createVisible).toBe(false);
    expect(page.state[detailKey]).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores an older %s after a newer detail action opens", async (outcome) => {
    const pending = deferred<typeof detail>();
    const currentDetail = { id: "current-plugin", name: "Current connector" };
    h.fetchMcpDetail.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(currentDetail);
    const page = createPage();
    const olderAction = start(page);
    await start(page, { id: currentDetail.id });
    if (outcome === "resolve") pending.resolve(detail);
    else pending.reject(new Error("old detail failure"));
    await olderAction;

    expect(page.state.createVisible).toBe(true);
    expect(page.state[detailKey]).toEqual(currentDetail);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("opens the current detail after a Space switch", async () => {
    const page = createPage();
    h.app.currentSpaceId = "space-b";
    page.handleSpaceChanged_();
    const currentDetail = { id: "space-b-plugin", name: "Space B connector" };
    h.fetchMcpDetail.mockResolvedValueOnce(currentDetail);
    await start(page, { id: currentDetail.id });

    expect(page.state.createVisible).toBe(true);
    expect(page.state[detailKey]).toEqual(currentDetail);
  });

  it("shows an error for the current failed detail action", async () => {
    h.fetchMcpDetail.mockRejectedValueOnce(new Error("current failure"));
    const page = createPage();
    await start(page);

    expect(page.state.createVisible).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith("current failure");
  });
});
