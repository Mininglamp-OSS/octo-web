// @vitest-environment jsdom
//
// dmworkmcp has no vitest config (no jsdom env, no `@octo/base` alias), hence
// the pragma above and the per-file `vi.mock`s below — same shape as
// McpDetailModal.inlineDelete.test.tsx. React is pinned to 17 here, so the
// suite drives ReactDOM.render + react-dom/test-utils act rather than RTL.
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// Tolerant matchers: the `t` stub echoes the key, so both the translated copy
// and the raw key count as a hit (mirrors the idiom in the skillmarket suite).
const reviewLabel = /组织发布管理|mcp\.sidebar\.review/;
const mineLabel = /我的发布|mcp\.sidebar\.mine/;

const h = vi.hoisted(() => ({
  spaceRole: { role: 3 as number | undefined, isReviewer: false, loading: false },
  pendingCount: 0,
  reviewOptions: [] as Array<Record<string, unknown>>,
  syncPath: vi.fn(),
  replaceToRoot: vi.fn(),
  currentPath: undefined as string | undefined,
  currentMenuId: undefined as string | undefined,
}));

vi.mock("@octo/base", () => ({
  I18nContext: React.createContext({}),
  t: (key: string) => key,
  Dap: { shared: { track: vi.fn() } },
  WKApp: {
    get currentMenuId() {
      return h.currentMenuId;
    },
    remoteConfig: undefined,
    route: {
      get currentPath() {
        return h.currentPath;
      },
      syncPath: (path: string) => h.syncPath(path),
    },
    routeRight: {
      replaceToRoot: (node: React.ReactElement) => h.replaceToRoot(node),
    },
    mittBus: { on: vi.fn(), off: vi.fn() },
  },
}));

vi.mock("@dmwork/skillmarket", () => ({
  SkillListPage: () => React.createElement("div", { "data-testid": "skills-page" }),
  SpaceReviewPage: () => React.createElement("div", { "data-testid": "review-page" }),
  useSpaceRole: () => h.spaceRole,
  useReviewRequests: (options: Record<string, unknown>) => {
    h.reviewOptions.push(options);
    return {
      items: [],
      total: h.pendingCount,
      loading: false,
      loadingMore: false,
      error: null,
      hasMore: false,
      pendingCount: h.pendingCount,
      refresh: () => undefined,
      loadMore: () => undefined,
    };
  },
}));

vi.mock("../../pages/McpMarketListPage", () => ({
  default: () => React.createElement("div", { "data-testid": "mcp-page" }),
}));
vi.mock("../../pages/ExpertMarketListPage", () => ({
  default: () => React.createElement("div", { "data-testid": "experts-page" }),
}));
vi.mock("../../pages/MyAssetsPage", () => ({
  default: () => React.createElement("div", { "data-testid": "mine-page" }),
}));

import { SkillListPage, SpaceReviewPage } from "@dmwork/skillmarket";
import MarketSidebar from "../MarketSidebar";

let container: HTMLDivElement | null = null;

function render() {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
  }
  act(() => {
    ReactDOM.render(React.createElement(MarketSidebar), container);
  });
  return container;
}

function rowLabels(): string[] {
  return Array.from(container!.querySelectorAll(".wk-mcp-sidebar__item-label")).map(
    (node) => node.textContent ?? ""
  );
}

beforeEach(() => {
  h.spaceRole = { role: 3, isReviewer: false, loading: false };
  h.pendingCount = 0;
  h.reviewOptions = [];
  h.currentPath = undefined;
  h.currentMenuId = undefined;
  h.syncPath.mockClear();
  h.replaceToRoot.mockClear();
});

afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

describe("MarketSidebar 组织发布管理 entry", () => {
  it("hides the entry from a plain member and keeps the other four intact", () => {
    render();

    const labels = rowLabels();
    expect(labels).toHaveLength(4);
    expect(labels.some((label) => reviewLabel.test(label))).toBe(false);
    expect(labels.some((label) => mineLabel.test(label))).toBe(true);
  });

  it("does not flash the entry while the role is still resolving", () => {
    h.spaceRole = { role: undefined, isReviewer: false, loading: true };
    render();

    expect(rowLabels().some((label) => reviewLabel.test(label))).toBe(false);
  });

  it("never fires the 403-ing mode=space read for a non-reviewer", () => {
    render();

    expect(h.reviewOptions.length).toBeGreaterThan(0);
    for (const options of h.reviewOptions) {
      expect(options).toMatchObject({ mode: "space", status: "pending", pageSize: 1 });
      expect(options.enabled).toBe(false);
    }
  });

  it("shows the entry to a Space admin and badges the pending count", () => {
    h.spaceRole = { role: 2, isReviewer: true, loading: false };
    h.pendingCount = 3;
    render();

    const labels = rowLabels();
    expect(labels).toHaveLength(5);
    expect(labels.some((label) => reviewLabel.test(label))).toBe(true);
    const badges = Array.from(container!.querySelectorAll(".wk-mcp-sidebar__badge")).map(
      (node) => node.textContent
    );
    // The 回路 pill stays dmloopOn-gated (remoteConfig is undefined here), so
    // the only badge on screen is the review count.
    expect(badges).toEqual(["3"]);
    expect(h.reviewOptions.at(-1)).toMatchObject({ enabled: true });
  });

  it("hides the badge when the queue is empty", () => {
    h.spaceRole = { role: 1, isReviewer: true, loading: false };
    h.pendingCount = 0;
    render();

    expect(container!.querySelectorAll(".wk-mcp-sidebar__badge")).toHaveLength(0);
  });

  it("resolves /mcp-market/review to the review page for a reviewer", () => {
    h.spaceRole = { role: 1, isReviewer: true, loading: false };
    h.currentPath = "/mcp-market/review";
    h.currentMenuId = "mcp-market";
    render();

    expect(h.replaceToRoot).toHaveBeenCalled();
    expect(h.replaceToRoot.mock.calls[0][0].type).toBe(SpaceReviewPage);
    const active = container!.querySelector(".wk-mcp-sidebar__item--active");
    expect(reviewLabel.test(active?.textContent ?? "")).toBe(true);
  });

  it("still mounts the deep link while the role is unresolved, then moves a member off it", () => {
    h.spaceRole = { role: undefined, isReviewer: false, loading: true };
    h.currentPath = "/mcp-market/review";
    h.currentMenuId = "mcp-market";
    render();

    // Unknown role: routing stays permissive so a reviewer's deep link is not
    // bounced. The row itself is still hidden.
    expect(h.replaceToRoot.mock.calls[0][0].type).toBe(SpaceReviewPage);
    expect(rowLabels().some((label) => reviewLabel.test(label))).toBe(false);

    // Role comes back "member" — the gate closes and the sidebar must move the
    // user to a permitted route rather than leave them on a 403ing view.
    h.spaceRole = { role: 3, isReviewer: false, loading: false };
    render();

    expect(h.replaceToRoot.mock.calls.at(-1)![0].type).toBe(SkillListPage);
    expect(h.syncPath).toHaveBeenCalledWith("/mcp-market/skills");
    const active = container!.querySelector(".wk-mcp-sidebar__item--active");
    expect(/技能|mcp\.sidebar\.skills/.test(active?.textContent ?? "")).toBe(true);
  });

  it("moves a reviewer off the org route when the new Space demotes them", () => {
    h.spaceRole = { role: 1, isReviewer: true, loading: false };
    h.currentPath = "/mcp-market/review";
    h.currentMenuId = "mcp-market";
    render();
    expect(h.replaceToRoot.mock.calls.at(-1)![0].type).toBe(SpaceReviewPage);

    h.spaceRole = { role: 3, isReviewer: false, loading: false };
    render();

    expect(h.replaceToRoot.mock.calls.at(-1)![0].type).toBe(SkillListPage);
    expect(h.syncPath).toHaveBeenCalledWith("/mcp-market/skills");
  });
});
