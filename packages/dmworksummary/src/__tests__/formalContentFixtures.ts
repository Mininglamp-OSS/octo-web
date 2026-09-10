import type { SummaryContentCatalog, SummaryFormalContent, SummaryGenerationConfiguration, SummaryContentGeneration, SummaryListContentActions } from "../Service/SummaryContentContract";

export function listContentActionsFixture(): SummaryListContentActions {
  const content = formalContentFixture();
  return { contract_version: 1, mode: "formal", content_id: content.content_id,
    business_scope: "single", capabilities: content.capabilities,
    generation_config: content.generation_config, active_generation: null };
}

export function formalContentFixture(): SummaryFormalContent {
  return {
    content_id: "sc1_personal", kind: "personal", owner_id: "owner", is_main: true, content_revision: 1,
    current_version: {
      content_id: "sc1_personal", version_id: "sv1_first", version: 1, content_revision: 1,
      content: "Old summary", citations: [], team_citations: [], citation_visibility: "not_generated", team_citation_visibility: "none",
      operation_type: "generate", operation_note: "", base_content_revision: 0, provisional: false, is_current: true, generated_at: "2026-09-08T09:00:00+08:00",
    },
    capabilities: { can_edit: true, can_refine: true, can_configure_schedule: true, can_schedule: false,
      can_regenerate_direct: false, can_regenerate_with_config: true, can_view_versions: true, can_save_as_new: false, can_delete: false, unavailable_reasons: {} },
    generation_config: { state: "incomplete", revision: 0, missing_fields: ["requirement"], unavailable_reason: null },
    active_generation: null, integrity: "consistent",
  };
}

export function formalCatalogFixture(content = formalContentFixture()): SummaryContentCatalog {
  return { contract_version: 1, summary_id: 12, created_via: "agent", main_content_id: content.content_id, contents: [content] };
}

export function generationConfigurationFixture(): SummaryGenerationConfiguration {
  return {
    state: "incomplete", revision: 0, missing_fields: ["requirement"], unavailable_reason: null,
    schedule: null, next_run_at: null,
    spec: { schema_version: 1, summary_mode: 2, collaboration: "single", participants: ["owner"],
      sources: [{ source_id: "group1", source_type: 1, confirmation: "legacy_unconfirmed" }],
      requirement: null, template: null, time_selector: { mode: "relative", days: 7, timezone: "Asia/Shanghai" },
      retrieval: { author_ids: [], keywords: [] }, citation_rules: { policy: "message_evidence" }, field_sources: {} },
  };
}

export function generationFixture(): SummaryContentGeneration {
  return {
    generation_id: "11111111-1111-4111-8111-111111111111", space_id: "space-a", task_id: 12, content_id: "sc1_personal",
    operation_type: "regenerate", executor: "workflow", generation_scope: "task", status: "pending", stage: "queued",
    effective_at: "2026-09-08T09:00:00+08:00", base_version_id: "sv1_first", base_content_revision: 1,
    config_revision: 1, applied: false, cancel_requested: false, created_at: "2026-09-08T09:00:00+08:00", updated_at: "2026-09-08T09:00:00+08:00",
  };
}
