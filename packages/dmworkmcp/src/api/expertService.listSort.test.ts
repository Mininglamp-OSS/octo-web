import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseTeamAgentsMarkdown } from "./expertWire";

// Mirror of expertService.addToLoop.test.ts's axios mock: expertService creates
// its own axios instance at module load, so mock the factory and pin the exact
// request shape. This file asserts the catalog list wire contract for the sort
// modes — the segmented sort control is only functional if the chosen mode
// actually reaches the backend as ?sort=… (the backend silently falls back to
// creation-time order for unknown/missing values, so a dropped param renders
// four visually-active but inert buttons).
const mock = vi.hoisted(() => ({
  logout: vi.fn(),
  requestOnFulfilled: undefined as
    | ((config: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
  responseOnRejected: undefined as
    | ((err: unknown) => Promise<unknown>)
    | undefined,
  instance: {
    interceptors: {
      request: {
        use: (onFulfilled: (config: Record<string, unknown>) => Record<string, unknown>) => {
          mock.requestOnFulfilled = onFulfilled;
        },
      },
      response: {
        use: (
          _onFulfilled: unknown,
          onRejected: (err: unknown) => Promise<unknown>
        ) => {
          mock.responseOnRejected = onRejected;
        },
      },
    },
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => mock.instance,
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    apiClient: { config: { apiURL: "/api/v1/" } },
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp", logout: mock.logout },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { listExperts, listSquads } from "./expertService";
import type { ExpertCatalogSort } from "./expertService";
import { WKApp } from "@octo/base";

const SORTS: ExpertCatalogSort[] = [
  "comprehensive",
  "latest",
  "installs",
  "views",
];

function lastListCall(): { url: string; params: Record<string, unknown> } {
  const call = mock.instance.get.mock.calls.at(-1) as [
    string,
    { params: Record<string, unknown> },
  ];
  return { url: call[0], params: call[1].params };
}

describe("expertService catalog sort wire contract", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    mock.instance.get.mockResolvedValue({
      data: { data: [], pagination: { total: 0, page: 1, page_size: 100 } },
    });
    WKApp.apiClient.config.apiURL = "/api/v1/";
  });

  it("resolves desktop marketplace requests against the API origin", () => {
    WKApp.apiClient.config.apiURL = "https://api.example.com/v1/";

    const next = mock.requestOnFulfilled?.({ headers: {} });

    expect(next?.baseURL).toBe("https://api.example.com");
  });

  it("keeps web and dev marketplace requests same-origin when apiURL is relative", () => {
    WKApp.apiClient.config.apiURL = "/api/v1/";

    const next = mock.requestOnFulfilled?.({ headers: {} });

    expect(next?.baseURL).toBe("");
  });

  it("listExperts sends every sort mode as the mapped ?sort param", async () => {
    const WIRE_SORT: Record<ExpertCatalogSort, string> = {
      comprehensive: "comprehensive",
      latest: "newest",
      installs: "installs",
      views: "views",
    };
    for (const sort of SORTS) {
      await listExperts({ sort });
      const { url, params } = lastListCall();
      expect(url).toBe("/market/api/v1/plugins");
      expect(params.scene_code).toBe("default");
      expect(params.plugin_type).toBe("expert");
      expect(params.sort).toBe(WIRE_SORT[sort]);
    }
  });

  it("listSquads targets expert_team and maps every sort mode", async () => {
    const WIRE_SORT: Record<ExpertCatalogSort, string> = {
      comprehensive: "comprehensive",
      latest: "newest",
      installs: "installs",
      views: "views",
    };
    for (const sort of SORTS) {
      await listSquads({ sort });
      const { url, params } = lastListCall();
      expect(url).toBe("/market/api/v1/plugins");
      expect(params.plugin_type).toBe("expert_team");
      expect(params.sort).toBe(WIRE_SORT[sort]);
    }
  });

  it("omits sort entirely when the caller does not set one", async () => {
    await listExperts();
    expect(lastListCall().params).not.toHaveProperty("sort");
  });
});

describe("parseTeamAgentsMarkdown — 后端 teamAgentsMarkdown 的逆向解析", () => {
  it("round-trips the deterministic team document", () => {
    // 与 octo-marketplace internal/backfill/plugin/mapping.go teamAgentsMarkdown
    // 的输出格式配对;改任一侧必须同步另一侧。
    const doc = [
      "# 产品研发专家团",
      "",
      "跨职能交付小组",
      "",
      "## 协作方式",
      "",
      "- Leader: 产品经理",
      "",
      "### 策略",
      "1. 先澄清目标",
      "2. 再评估风险",
      "",
      "### 依赖",
      "- 阻塞: 需求文档",
      "- 推荐: 设计稿",
      "",
      "### 权限",
      "open",
      "",
    ].join("\n");
    const parsed = parseTeamAgentsMarkdown(doc);
    expect(parsed.leader).toBe("产品经理");
    expect(parsed.strategies).toEqual(["先澄清目标", "再评估风险"]);
    expect(parsed.dependencies).toEqual({
      blocking: ["需求文档"],
      recommended: ["设计稿"],
    });
    expect(parsed.permission).toBe("open");
  });

  it("returns empty config for minimal documents", () => {
    const parsed = parseTeamAgentsMarkdown("# 团队\n\n## 协作方式\n");
    expect(parsed).toEqual({
      leader: "",
      strategies: [],
      dependencies: { blocking: [], recommended: [] },
      permission: "",
    });
  });
});
