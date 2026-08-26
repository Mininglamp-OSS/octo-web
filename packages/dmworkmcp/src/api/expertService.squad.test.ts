import { beforeEach, describe, expect, it, vi } from "vitest";

// expertService builds its own axios instance and imports @octo/base at module
// load; capture the instance so we can pin the upsert/publish request bodies
// without a real backend (mirrors expertService.addToLoop.test.ts).
const mock = vi.hoisted(() => ({
  posts: [] as Array<{ url: string; body: any }>,
  publishRejects: false,
  instance: {
    interceptors: {
      request: { use: () => {} },
      response: { use: () => {} },
    },
    get: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: { create: () => mock.instance, isCancel: () => false },
}));
vi.mock("@octo/base", () => ({
  WKApp: { loginInfo: { token: "tok" }, shared: { currentSpaceId: "sp", logout: vi.fn() } },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { createExpert, createSquad } from "./expertService";

const endsWith = (url: string, suffix: string) => url.endsWith(suffix);

beforeEach(() => {
  mock.posts = [];
  mock.publishRejects = false;
  mock.instance.post.mockReset();
  mock.instance.post.mockImplementation((url: string, body: any) => {
    mock.posts.push({ url, body });
    if (endsWith(url, "/plugins/publish")) {
      if (mock.publishRejects) return Promise.reject(new Error("publish failed"));
      return Promise.resolve({ data: { data: {} } });
    }
    // upsert / delete
    return Promise.resolve({ data: { data: { plugin: { plugin_id: "pl-1" } } } });
  });
});

const squadForm = {
  name: "产品战略专家团",
  summary: "统筹拆解与汇总",
  tags: ["战略"],
  instruction: "# 团队\n## 团队定位\n随任务调用成员。",
  members: [
    { pluginId: "m-1", name: "分诊", memberKey: "m-1", isLeader: true },
    { pluginId: "m-2", name: "洞察" },
  ],
};

describe("createSquad upsert contract", () => {
  it("upserts an expert_team plugin with verbatim AGENTS.md and member relations", async () => {
    const { id } = await createSquad(squadForm);
    expect(id).toBe("pl-1");

    const upsert = mock.posts.find((p) => endsWith(p.url, "/plugins/upsert"));
    expect(upsert).toBeDefined();
    const plugin = upsert!.body.plugin;
    expect(plugin.plugin_type).toBe("expert_team");
    expect(plugin.manifest_json.plugin_type).toBe("expert_team");

    // AGENTS.md written verbatim (no structured-format reconstruction).
    const atts = plugin.plugin_json.attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].path).toBe("AGENTS.md");
    expect(atts[0].content_type).toBe("raw");
    expect(atts[0].raw_content).toBe(squadForm.instruction);

    // expert_team_expert relations carry member wiring in `data`.
    const rels = upsert!.body.relations;
    expect(rels).toHaveLength(2);
    expect(rels[0]).toMatchObject({
      relation_type: "expert_team_expert",
      target_plugin_id: "m-1",
      sort_order: 0,
      data: { member_key: "m-1", role: "", is_leader: true },
    });
    expect(rels[1]).toMatchObject({
      relation_type: "expert_team_expert",
      target_plugin_id: "m-2",
      sort_order: 1,
      data: { member_key: "m-2", role: "", is_leader: false },
    });
  });

  it("publishes the scene placement after upsert", async () => {
    await createSquad(squadForm);
    const publish = mock.posts.find((p) => endsWith(p.url, "/plugins/publish"));
    expect(publish).toBeDefined();
    expect(publish!.body.plugin_id).toBe("pl-1");
  });

  it("rolls back (deletes) the orphan plugin when publish fails", async () => {
    mock.publishRejects = true;
    await expect(createSquad(squadForm)).rejects.toThrow();
    const del = mock.posts.find((p) => endsWith(p.url, "/plugins/delete"));
    expect(del).toBeDefined();
    expect(del!.body.plugin_id).toBe("pl-1");
  });
});

describe("createExpert publishToScene option", () => {
  const expertForm = { name: "E", summary: "", tags: [], instruction: "hi", mcpConfig: "" };

  it("publishes by default", async () => {
    await createExpert(expertForm);
    expect(mock.posts.some((p) => endsWith(p.url, "/plugins/publish"))).toBe(true);
  });

  it("skips scene publish for squad members (publishToScene:false)", async () => {
    await createExpert(expertForm, { publishToScene: false });
    expect(mock.posts.some((p) => endsWith(p.url, "/plugins/upsert"))).toBe(true);
    expect(mock.posts.some((p) => endsWith(p.url, "/plugins/publish"))).toBe(false);
  });
});
