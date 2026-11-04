import { describe, expect, it } from "vitest";
import { editPublicationDraft } from "./publicationDraft";
import type { PluginDetailWire } from "../../api/pluginWire";

describe("publication draft editing", () => {
  it("preserves opaque attachments and member metadata while changing one pin", () => {
    const draft = {
      draft_revision: "r1",
      plugin: {
        plugin_id: "team",
        plugin_name: "Old",
        plugin_type: "expert_team",
        manifest_json: {
          plugin_name: "Old",
          description: "old",
          custom: { keep: true },
        },
        plugin_json: {
          attachments: [
            { path: "AGENTS.md", content_type: "raw", raw_content: "old" },
            {
              path: "assets/binary.bin",
              content_type: "storage",
              mime_type: "application/octet-stream",
            },
          ],
        },
        icon: "stored-key",
        tags: ["tag"],
        visibility: "private",
      },
      relations: [
        {
          relation_id: "r",
          target_plugin_id: "member",
          target_version_id: "v1",
          relation_type: "expert_team_expert",
          sort_order: 4,
          data: { member_key: "lead", is_leader: true, role: "architect" },
        },
      ],
    } as unknown as PluginDetailWire;
    const next = editPublicationDraft(draft, {
      name: "New",
      description: "new",
      instruction: "changed",
      version: "1.0.1",
      changelog: "update",
      versions: { member: "v2" },
    });
    expect(next.expected_draft_revision).toBe("r1");
    expect(next.plugin.icon).toBe("stored-key");
    expect(next.plugin.manifest_json).toMatchObject({
      custom: { keep: true },
      plugin_name: "New",
      description: "new",
    });
    expect(next.plugin.plugin_json?.attachments?.[1]).toEqual(
      draft.plugin.plugin_json?.attachments?.[1]
    );
    expect(next.relations[0]).toMatchObject({
      relation_id: "r",
      target_version_id: "v2",
      sort_order: 4,
      data: { is_leader: true, role: "architect" },
    });
    expect(draft.relations[0].target_version_id).toBe("v1");
  });
  it("never gives a connector edge a version", () => {
    const draft = {
      draft_revision: "r",
      plugin: {
        plugin_id: "a",
        manifest_json: {},
        plugin_json: { attachments: [] },
      },
      relations: [
        {
          target_plugin_id: "mcp",
          relation_type: "expert_connector",
          sort_order: 0,
        },
      ],
    } as unknown as PluginDetailWire;
    const next = editPublicationDraft(draft, {
      name: "a",
      description: "",
      instruction: "",
      version: "1.0.1",
      changelog: "",
      versions: { mcp: "forbidden" },
    });
    expect(next.relations[0].target_version_id).toBeUndefined();
  });
});
