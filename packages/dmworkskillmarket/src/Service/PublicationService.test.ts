import { beforeEach, describe, it, expect, vi } from "vitest";
const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@octo/base", () => ({ APIClient: { shared: http } }));
import { PublicationService } from "./PublicationService";
import { subscribeReviewsChanged } from "../api/reviewSignal";
import type { PublicationWrite } from "../features/publications/publicationDraft";
beforeEach(() => {
  Object.values(http).forEach((fn) => fn.mockReset());
  http.get.mockResolvedValue({ data: {} });
  http.post.mockResolvedValue({ data: { display_status: "pending_review" } });
  http.patch.mockResolvedValue({ data: { display_status: "pending_review" } });
});
describe("publication service contracts", () => {
  it("refreshes independent review readers after a publish and a rejected visibility change", async () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeReviewsChanged(refresh);
    try {
      await PublicationService.publishDraft("/market", "expert", "1.1.0", "notes", "draft");
      expect(refresh).toHaveBeenCalledTimes(1);
      http.patch.mockRejectedValueOnce(new Error("stale plan"));
      await expect(PublicationService.changeVisibility("/market", "expert", "space", "plan")).rejects.toThrow("stale plan");
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });
  it("encodes resource IDs and passes the marketplace base explicitly", async () => {
    await PublicationService.getDraft("https://market.example/api/v1", "a/b");
    expect(http.get).toHaveBeenCalledWith("/plugins/a%2Fb/draft", {
      baseURL: "https://market.example/api/v1",
    });
  });
  it("keeps the edited draft revision rather than substituting a newer reminder read", async () => {
    const draft = {
      expected_draft_revision: "original",
      changelog: "notes",
      plugin: { version: "1.1.0" },
      relations: [],
    } as unknown as PublicationWrite;
    await PublicationService.adoptUpdates(
      "/market/api/v1",
      "expert",
      {
        plugin_id: "expert",
        published_version_id: "release",
        draft_revision: "newer",
        updates: [],
      },
      draft,
      [{ plugin_id: "skill", target_version_id: "v2" } as never]
    );
    expect(http.post).toHaveBeenCalledWith(
      "/plugins/expert/dependency_updates",
      expect.objectContaining({
        expected_published_version_id: "release",
        expected_draft_revision: "original",
        draft,
        targets: [{ plugin_id: "skill", target_version_id: "v2" }],
      }),
      { baseURL: "/market/api/v1" }
    );
  });
  it("persists only skip tuples without publishing or saving a draft", async () => {
    await PublicationService.skipUpdates("/market/api/v1", "expert", [
      { plugin_id: "skill", target_version_id: "v2" } as never,
    ]);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      "/plugins/expert/dependency_updates/_skip",
      { targets: [{ plugin_id: "skill", target_version_id: "v2" }] },
      expect.any(Object)
    );
  });
  it("uses a configuration revision for connector skip and adoption", async () => {
    const update = {plugin_id:"connector",plugin_type:"connector",target_config_revision:"new-config",target_version_id:""} as never;
    const draft = {plugin:{version:"1.1.0"},relations:[{relation_type:"expert_connector",target_plugin_id:"connector"}]} as unknown as PublicationWrite;
    await PublicationService.skipUpdates("/market","expert",[update]);
    await PublicationService.adoptUpdates("/market","expert",{plugin_id:"expert",draft_revision:"d",published_version_id:"r",updates:[update]},draft,[update]);
    for (const [,body] of http.post.mock.calls) expect(body.targets).toEqual([{plugin_id:"connector",target_config_revision:"new-config"}]);
  });
  it("passes the exact confirmed visibility plan revision", async () => {
    await PublicationService.changeVisibility(
      "/market/api/v1",
      "expert",
      "space",
      "plan"
    );
    expect(http.patch).toHaveBeenCalledWith(
      "/plugins/expert/visibility",
      { visibility: "space", expected_plan_revision: "plan" },
      expect.any(Object)
    );
  });
  it("publishes conditionally against the just-saved draft", async () => {
    await PublicationService.publishDraft(
      "/market/api/v1",
      "expert",
      "1.0.2",
      "notes",
      "revision"
    );
    expect(http.post).toHaveBeenCalledWith(
      "/plugins/publish",
      {
        plugin_id: "expert",
        version: "1.0.2",
        changelog: "notes",
        expected_draft_revision: "revision",
      },
      expect.any(Object)
    );
  });
  it("retains the formal label of an old pin outside the newest version page", async () => {
    http.get
      .mockResolvedValueOnce({
        data: { plugin: { plugin_name: "Skill", plugin_type: "skill" } },
      })
      .mockResolvedValueOnce({
        data: [{ version_id: "new", release: { version_label: "2.0.0" } }],
      })
      .mockResolvedValueOnce({
        data: {
          version: { version_id: "old", release: { version_label: "1.0.0" } },
        },
      });
    const deps = await PublicationService.getDependencies("/market", {
      relations: [
        {
          target_plugin_id: "skill",
          target_version_id: "old",
          relation_type: "expert_skill",
        },
      ],
    } as never);
    expect(deps[0].versions).toEqual([
      { id: "new", label: "2.0.0" },
      { id: "old", label: "1.0.0" },
    ]);
    expect(http.get).toHaveBeenLastCalledWith("/plugins/skill/versions/old", {
      baseURL: "/market",
    });
  });

  it("preserves an unreadable dependency and still resolves the remaining connector", async () => {
    http.get.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({
      data: {
        plugin: { plugin_name: "Connector", plugin_type: "connector" },
      },
    });
    const deps = await PublicationService.getDependencies("/market", {
      relations: [
        {
          target_plugin_id: "hidden",
          target_version_id: "old",
          relation_type: "expert_skill",
        },
        { target_plugin_id: "connector", relation_type: "expert_connector" },
      ],
    } as never);
    expect(deps).toEqual([
      {
        id: "hidden",
        name: "",
        current: "old",
        type: "skill",
        versions: [],
        unavailable: true,
      },
      { id: "connector", name: "Connector", type: "connector", versions: [] },
    ]);
  });
});
