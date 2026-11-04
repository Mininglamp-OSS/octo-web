import type {
  PluginDetailWire,
  PluginRelationWire,
} from "../../api/pluginWire";

export interface PublicationFields {
  name: string;
  description: string;
  instruction: string;
  version: string;
  changelog: string;
  versions: Record<string, string>;
}
export interface PublicationWrite {
  expected_draft_revision?: string;
  changelog: string;
  plugin: PluginDetailWire["plugin"] & { version: string };
  relations: PluginRelationWire[];
}
/** Full replacement preserves every field we don't explicitly edit. */
export function editPublicationDraft(
  draft: PluginDetailWire,
  fields: PublicationFields
): PublicationWrite {
  const source = draft.plugin;
  const attachments = (source.plugin_json?.attachments ?? []).map((a) => ({
    ...a,
  }));
  const at = attachments.findIndex((a) => a.path === "AGENTS.md");
  const instruction = {
    path: "AGENTS.md",
    content_type: "raw" as const,
    mime_type: "text/markdown",
    raw_content: fields.instruction,
  };
  if (at >= 0) attachments[at] = instruction;
  else attachments.push(instruction);
  return {
    expected_draft_revision: draft.draft_revision,
    changelog: fields.changelog,
    plugin: {
      plugin_id: source.plugin_id,
      plugin_type: source.plugin_type,
      plugin_name: fields.name,
      version: fields.version,
      category_id: source.category_id,
      tags: source.tags ?? [],
      publisher: source.publisher,
      icon: source.icon,
      visibility: source.visibility,
      manifest_json: {
        ...source.manifest_json,
        plugin_name: fields.name,
        description: fields.description,
      },
      plugin_json: { ...source.plugin_json, attachments },
    } as PublicationWrite["plugin"],
    relations: draft.relations.map((ref) => ({
      ...ref,
      ...(ref.relation_type !== "expert_connector" &&
      fields.versions[ref.target_plugin_id]
        ? { target_version_id: fields.versions[ref.target_plugin_id] }
        : {}),
    })),
  };
}
