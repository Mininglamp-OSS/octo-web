import { describe, expect, it, beforeEach, vi } from "vitest";

// expertService builds its own axios instance at import, so mock the factory and
// drive per-URL/per-id responses (same pattern as expertService.listSort.test).
const mock = vi.hoisted(() => ({
  instance: {
    interceptors: {
      request: { use: () => undefined },
      response: { use: () => undefined },
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
    shared: { currentSpaceId: "sp" },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { getExpert } from "./expertService";
import { ExpertListError } from "./expertListError";

const EXPERT_WIRE = {
  plugin: {
    plugin_id: "expert-1",
    plugin_name: "E1",
    plugin_type: "expert",
    manifest_json: { description: "d" },
    plugin_json: { attachments: [] },
  },
  relations: [
    { relation_type: "expert_skill", target_plugin_id: "skill-ok", sort_order: 0 },
    { relation_type: "expert_skill", target_plugin_id: "skill-bad", sort_order: 1 },
  ],
};

const SKILL_OK = {
  plugin: {
    plugin_id: "skill-ok",
    plugin_name: "OK Skill",
    plugin_type: "skill",
    plugin_json: { attachments: [] },
  },
};

/** Drive /plugins/detail by plugin_id; skill-bad rejects with the given status. */
function wireWith(badStatus: number) {
  mock.instance.get.mockImplementation(
    (url: string, config?: { params?: { plugin_id?: string } }) => {
      if (url.endsWith("/plugin_categories")) {
        return Promise.resolve({ data: { data: [] } });
      }
      if (url.endsWith("/plugins/detail")) {
        const pid = config?.params?.plugin_id;
        if (pid === "expert-1") return Promise.resolve({ data: { data: EXPERT_WIRE } });
        if (pid === "skill-ok") return Promise.resolve({ data: { data: SKILL_OK } });
        if (pid === "skill-bad") return Promise.reject({ response: { status: badStatus } });
      }
      return Promise.resolve({ data: { data: {} } });
    }
  );
}

describe("expert detail — relation-fetch error handling", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
  });

  it("drops a CONFIRMED 404 skill target and still renders the rest", async () => {
    wireWith(404);
    const expert = await getExpert("expert-1");
    // The dangling (404) skill is dropped; the resolvable one survives.
    expect(expert.skills.map((s) => s.name)).toEqual(["OK Skill"]);
  });

  it("REJECTS the whole detail on a non-404 (500) skill failure — no silent partial", async () => {
    wireWith(500);
    await expect(getExpert("expert-1")).rejects.toBeInstanceOf(ExpertListError);
  });

  it("REJECTS on a 403 skill failure too (not silently dropped)", async () => {
    wireWith(403);
    await expect(getExpert("expert-1")).rejects.toBeInstanceOf(ExpertListError);
  });
});
