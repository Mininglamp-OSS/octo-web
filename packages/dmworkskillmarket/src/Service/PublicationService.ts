import { APIClient } from "@octo/base";
import type { PluginDetailWire } from "../api/pluginWire";
import type { PublicationWrite } from "../features/publications/publicationDraft";

export interface DependencyUpdate {
  plugin_id: string;
  name: string;
  plugin_type: string;
  from_version_id: string;
  from_version: string;
  target_version_id: string;
  target_version: string;
  is_skipped: boolean;
}
export interface DependencyUpdates {
  plugin_id: string;
  published_version_id: string;
  draft_revision: string;
  updates: DependencyUpdate[];
}
export interface VisibilityPlanItem {
  plugin_id: string;
  name?: string;
  plugin_type: string;
  from: string;
  to: string;
  published_version_id?: string;
  baseline: string;
}
export interface VisibilityPlan {
  plugin_id: string;
  plan_revision: string;
  changes: VisibilityPlanItem[];
  affected: VisibilityPlanItem[];
  blockers: Array<{ plugin_id: string; name?: string; reason: string }>;
}
export interface PublicationDependency {
  id: string;
  name: string;
  type: string;
  current?: string;
  unavailable?: boolean;
  versions: Array<{ id: string; label: string }>;
}
export interface PublicationOutcome {
  plugin_id: string;
  display_status: string;
  review_id?: string;
}
const unwrap = <T>(value: T | { data: T }): T =>
  value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
const path = (id: string) => `/plugins/${encodeURIComponent(id)}`;
export const PublicationService = {
  async publishDraft(
    baseURL: string,
    id: string,
    version: string,
    changelog: string,
    revision: string
  ): Promise<PublicationOutcome> {
    return unwrap(
      await APIClient.shared.post(
        "/plugins/publish",
        {
          plugin_id: id,
          version,
          changelog,
          expected_draft_revision: revision,
        },
        { baseURL }
      )
    );
  },
  async getDraft(baseURL: string, id: string): Promise<PluginDetailWire> {
    return unwrap(await APIClient.shared.get(`${path(id)}/draft`, { baseURL }));
  },
  async saveDraft(
    baseURL: string,
    draft: PublicationWrite
  ): Promise<PluginDetailWire> {
    return unwrap(
      await APIClient.shared.post("/plugins/upsert", draft, { baseURL })
    );
  },
  async getUpdates(baseURL: string, id: string): Promise<DependencyUpdates> {
    return unwrap(
      await APIClient.shared.get(`${path(id)}/dependency_updates`, { baseURL })
    );
  },
  async skipUpdates(
    baseURL: string,
    id: string,
    updates: DependencyUpdate[]
  ): Promise<void> {
    await APIClient.shared.post(
      `${path(id)}/dependency_updates/_skip`,
      {
        targets: updates.map((u) => ({
          plugin_id: u.plugin_id,
          target_version_id: u.target_version_id,
        })),
      },
      { baseURL }
    );
  },
  async adoptUpdates(
    baseURL: string,
    id: string,
    source: DependencyUpdates,
    draft: PublicationWrite,
    updates: DependencyUpdate[]
  ): Promise<PublicationOutcome> {
    return unwrap(
      await APIClient.shared.post(
        `${path(id)}/dependency_updates`,
        {
          expected_published_version_id: source.published_version_id,
          expected_draft_revision: draft.expected_draft_revision,
          targets: updates.map((u) => ({
            plugin_id: u.plugin_id,
            target_version_id: u.target_version_id,
          })),
          draft,
          version: draft.plugin.version,
          changelog: draft.changelog,
        },
        { baseURL }
      )
    );
  },
  async getVisibilityPlan(
    baseURL: string,
    id: string,
    visibility: string
  ): Promise<VisibilityPlan> {
    return unwrap(
      await APIClient.shared.get(`${path(id)}/visibility_plan`, {
        baseURL,
        param: { visibility },
      })
    );
  },
  async changeVisibility(
    baseURL: string,
    id: string,
    visibility: string,
    revision: string
  ): Promise<PublicationOutcome> {
    return unwrap(
      await APIClient.shared.patch(
        `${path(id)}/visibility`,
        { visibility, expected_plan_revision: revision },
        { baseURL }
      )
    );
  },
  async getDependencies(
    baseURL: string,
    draft: PluginDetailWire
  ): Promise<PublicationDependency[]> {
    return Promise.all(
      draft.relations.map(async (ref): Promise<PublicationDependency> => {
        try {
          const detail = unwrap<PluginDetailWire>(
            await APIClient.shared.get("/plugins/detail", {
              baseURL,
              param: { plugin_id: ref.target_plugin_id },
            })
          );
          if (ref.relation_type === "expert_connector")
            return {
              id: ref.target_plugin_id,
              name: detail.plugin.plugin_name,
              type: "connector",
              versions: [],
            };
          const versions = unwrap<
            Array<{ version_id: string; release?: { version_label: string } }>
          >(
            await APIClient.shared.get("/plugins/versions", {
              baseURL,
              param: { plugin_id: ref.target_plugin_id, page_size: 100 },
            })
          );
          // A pinned release can be older than the paged history. Resolve that
          // immutable version explicitly so its human label stays selectable.
          if (
            ref.target_version_id &&
            !versions.some((v) => v.version_id === ref.target_version_id)
          ) {
            const pinned = unwrap<{
              version: {
                version_id: string;
                release?: { version_label: string };
              };
            }>(
              await APIClient.shared.get(
                `${path(ref.target_plugin_id)}/versions/${encodeURIComponent(
                  ref.target_version_id
                )}`,
                { baseURL }
              )
            );
            if (pinned.version.release) versions.push(pinned.version);
          }
          return {
            id: ref.target_plugin_id,
            name: detail.plugin.plugin_name,
            type: detail.plugin.plugin_type,
            current: ref.target_version_id,
            versions: versions
              .filter((v) => v.release)
              .map((v) => ({
                id: v.version_id,
                label: v.release!.version_label,
              })),
          };
        } catch {
          // Preserve the opaque reference even when its current audience no
          // longer permits this owner to read it. Publication still validates.
          return {
            id: ref.target_plugin_id,
            name: "",
            current: ref.target_version_id,
            type:
              ref.relation_type === "expert_connector"
                ? "connector"
                : ref.relation_type === "expert_team_expert"
                ? "expert"
                : "skill",
            versions: [],
            unavailable: true,
          };
        }
      })
    );
  },
  async getInstruction(
    baseURL: string,
    draft: PluginDetailWire
  ): Promise<string> {
    const attachment = draft.plugin.plugin_json?.attachments?.find(
      (a) => a.path === "AGENTS.md"
    );
    if (!attachment) return "";
    if (attachment.content_type === "raw") return attachment.raw_content ?? "";
    if (!draft.plugin.current_version_id)
      throw new Error("Missing editable content version");
    const bytes = await APIClient.shared.get(
      `${path(draft.plugin.plugin_id)}/versions/${encodeURIComponent(
        draft.plugin.current_version_id
      )}/file`,
      { baseURL, param: { path: "AGENTS.md" }, responseType: "arraybuffer" }
    );
    return new TextDecoder().decode(bytes);
  },
};
