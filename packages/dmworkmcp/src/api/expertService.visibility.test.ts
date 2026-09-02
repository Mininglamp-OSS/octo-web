import { describe, expect, it, beforeEach, vi } from "vitest";

// expertService builds its own axios instance at import, so mock the factory and
// drive per-URL responses (same pattern as expertService.relationErrors.test).
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

import { updateExpertVisibility } from "./expertService";

/**
 * A squad as the backend returns it: a category, a publisher, a stored icon key
 * alongside the presigned display URL, documents this package has no model of,
 * and two member edges whose `data` carries the install-time wiring.
 */
const SQUAD_WIRE = {
  plugin: {
    plugin_id: "squad-1",
    plugin_name: "S1",
    plugin_type: "expert_team",
    category_id: "cat-7",
    tags: ["a", "b"],
    publisher: "Octo",
    icon: "plugins/icons/abc.png",
    icon_url: "https://cdn.example/presigned?sig=expires-soon",
    visibility: "private",
    listing_state: "published",
    current_version: "2.4.0",
    manifest_json: { description: "d", labels: ["a", "b"] },
    plugin_json: {
      attachments: [
        { path: "AGENTS.md", content_type: "raw", raw_content: "# team" },
        {
          path: "team/opaque.bin",
          content_type: "storage",
          content_hash: "h1",
          content_size: 12,
        },
      ],
    },
  },
  relations: [
    {
      relation_id: "rel-1",
      source_plugin_id: "squad-1",
      target_plugin_id: "member-a",
      relation_type: "expert_team_expert",
      sort_order: 0,
      data: { member_key: "lead", is_leader: true },
    },
    {
      relation_id: "rel-2",
      source_plugin_id: "squad-1",
      target_plugin_id: "member-b",
      relation_type: "expert_team_expert",
      sort_order: 1,
      data: { member_key: "worker" },
    },
  ],
};

function wire() {
  mock.instance.get.mockImplementation((url: string) => {
    if (url.endsWith("/plugins/detail")) {
      return Promise.resolve({ data: { data: SQUAD_WIRE } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
  mock.instance.post.mockResolvedValue({ data: { data: SQUAD_WIRE } });
}

/** The single upsert body the call under test posted. */
function postedBody() {
  const call = mock.instance.post.mock.calls.find((c: unknown[]) =>
    String(c[0]).endsWith("/plugins/upsert")
  );
  expect(call).toBeDefined();
  return (call as unknown[])[1] as {
    plugin: Record<string, unknown>;
    relations: Array<Record<string, unknown>>;
  };
}

describe("updateExpertVisibility — the full-replace echo", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    mock.instance.post.mockReset();
  });

  it("writes the new audience and nothing else", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    const body = postedBody();
    expect(body.plugin.plugin_id).toBe("squad-1");
    expect(body.plugin.visibility).toBe("space");
    // `/plugins/upsert` is a FULL REPLACE: any field left out is written as its
    // zero value, so a visibility change has to carry the whole record back.
    expect(body.plugin.plugin_name).toBe("S1");
    expect(body.plugin.plugin_type).toBe("expert_team");
    expect(body.plugin.category_id).toBe("cat-7");
    expect(body.plugin.tags).toEqual(["a", "b"]);
    expect(body.plugin.publisher).toBe("Octo");
  });

  it("echoes the stored icon key, never the expiring display URL", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    expect(postedBody().plugin.icon).toBe("plugins/icons/abc.png");
  });

  it("echoes the Bot-authored documents verbatim", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    const body = postedBody();
    // There is no client-side form for these types, so this package cannot
    // rebuild either document — anything less than a verbatim echo destroys the
    // parts it does not model (here, a storage attachment it has never heard of).
    expect(body.plugin.manifest_json).toEqual(SQUAD_WIRE.plugin.manifest_json);
    expect(body.plugin.plugin_json).toEqual(SQUAD_WIRE.plugin.plugin_json);
  });

  it("omits the version so the backend keeps the current label", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    expect(postedBody().plugin).not.toHaveProperty("version");
  });

  it("re-sends every child edge with its id and its wiring data", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    // Relations absent from the body are soft-deleted; relations sent WITHOUT
    // their relation_id are deleted and re-inserted, which loses the `data` that
    // makes a squad installable. Both have to survive a visibility flip.
    expect(postedBody().relations).toEqual([
      {
        relation_id: "rel-1",
        target_plugin_id: "member-a",
        relation_type: "expert_team_expert",
        sort_order: 0,
        data: { member_key: "lead", is_leader: true },
      },
      {
        relation_id: "rel-2",
        target_plugin_id: "member-b",
        relation_type: "expert_team_expert",
        sort_order: 1,
        data: { member_key: "worker" },
      },
    ]);
  });

  it("reads the relation graph, so the detail fetch must ask for it", async () => {
    wire();
    await updateExpertVisibility("squad-1", "space");
    const detailCall = mock.instance.get.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith("/plugins/detail")
    ) as [string, { params?: Record<string, unknown> }];
    expect(detailCall[1].params).toMatchObject({
      plugin_id: "squad-1",
      include_relations: true,
    });
  });

  it("surfaces a readable message when the record cannot be read", async () => {
    mock.instance.get.mockRejectedValue({ response: { status: 403 } });
    // The list helpers rewrap every failure as an ExpertListError whose message
    // is the bare classification kind ("forbidden"). The caller renders
    // `err.message` straight into the modal, so it must be a translated string.
    await expect(updateExpertVisibility("squad-1", "space")).rejects.toThrow(
      "mcp.list.error.forbidden"
    );
    expect(mock.instance.post).not.toHaveBeenCalled();
  });
});
