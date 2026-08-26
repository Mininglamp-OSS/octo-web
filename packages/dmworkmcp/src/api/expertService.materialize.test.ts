import { beforeEach, describe, expect, it, vi } from "vitest";

// expertService builds its own axios instance and imports @octo/base +
// @dmwork/skillmarket at module load; mock all three so the materialize/rollback
// orchestration can be pinned without a real backend.
const mock = vi.hoisted(() => ({
  posts: [] as Array<{ url: string; body: any }>,
  upsertRejects: false,
  createSkill: vi.fn(),
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
vi.mock("@dmwork/skillmarket", () => ({
  createSkillFromScratch: (...args: unknown[]) => mock.createSkill(...args),
}));

import { materializeExpert, materializeSkillDrafts } from "./expertService";

const endsWith = (url: string, suffix: string) => url.endsWith(suffix);

let skillSeq = 0;
beforeEach(() => {
  mock.posts = [];
  mock.upsertRejects = false;
  skillSeq = 0;
  mock.createSkill.mockReset();
  mock.createSkill.mockImplementation(() =>
    Promise.resolve({ id: `sk-${++skillSeq}` })
  );
  mock.instance.post.mockReset();
  mock.instance.post.mockImplementation((url: string, body: any) => {
    mock.posts.push({ url, body });
    if (endsWith(url, "/plugins/upsert")) {
      if (mock.upsertRejects) return Promise.reject(new Error("upsert failed"));
      return Promise.resolve({ data: { data: { plugin: { plugin_id: "ex-1" } } } });
    }
    return Promise.resolve({ data: { data: {} } }); // publish / delete
  });
});

const draft = {
  name: "分诊",
  summary: "分诊专家",
  tags: [],
  instruction: "hi",
  mcpConfig: "",
  existingSkillIds: ["sk-existing"],
  draftSkills: [
    { displayName: "S1", name: "S1", description: "", tags: [], attachments: [] },
    { displayName: "S2", name: "S2", description: "", tags: [], attachments: [] },
  ],
};

describe("materializeSkillDrafts", () => {
  it("creates each draft (private, unpublished) and returns ids in order", async () => {
    const ids = await materializeSkillDrafts(draft.draftSkills);
    expect(ids).toEqual(["sk-1", "sk-2"]);
    expect(mock.createSkill).toHaveBeenCalledTimes(2);
    expect(mock.createSkill).toHaveBeenNthCalledWith(1, draft.draftSkills[0], {
      publishToScene: false,
    });
  });
});

describe("materializeExpert", () => {
  it("materializes draft skills then creates the expert wired to all of them", async () => {
    const { id, createdPluginIds } = await materializeExpert(draft, { publishToScene: false });

    expect(id).toBe("ex-1");
    // Skills first, then the expert — all tracked for rollback.
    expect(createdPluginIds).toEqual(["sk-1", "sk-2", "ex-1"]);

    const upsert = mock.posts.find((p) => endsWith(p.url, "/plugins/upsert"));
    expect(upsert).toBeDefined();
    const rels = upsert!.body.relations;
    // existing + both new drafts, as expert_skill relations.
    expect(rels.map((r: any) => r.target_plugin_id)).toEqual(["sk-existing", "sk-1", "sk-2"]);
    expect(rels.every((r: any) => r.relation_type === "expert_skill")).toBe(true);
    // publishToScene:false → no scene publish.
    expect(mock.posts.some((p) => endsWith(p.url, "/plugins/publish"))).toBe(false);
  });

  it("rolls back created skills when the expert create fails", async () => {
    mock.upsertRejects = true;

    await expect(materializeExpert(draft, { publishToScene: false })).rejects.toThrow();

    // Both created skills are deleted (rollback), reverse order.
    const deletes = mock.posts
      .filter((p) => endsWith(p.url, "/plugins/delete"))
      .map((p) => p.body.plugin_id);
    expect(deletes).toEqual(["sk-2", "sk-1"]);
  });
});
