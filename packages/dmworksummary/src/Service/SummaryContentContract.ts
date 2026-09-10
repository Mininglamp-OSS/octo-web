import type { CitationItem, TeamCitationItem } from "../types/summary";

/**
 * Formal content identities are opaque strings. Workbench preview
 * scope_version/artifact_version/snapshot_version are NOT these identities.
 */
export interface SummaryContentCapabilities {
  can_edit: boolean;
  can_refine: boolean;
  can_save_as_new: boolean;
  can_configure_schedule: boolean;
  can_schedule: boolean;
  can_regenerate_direct: boolean;
  can_regenerate_with_config: boolean;
  can_view_versions: boolean;
  can_delete: boolean;
  unavailable_reasons: Record<string, string>;
}

export interface SummaryContentConfiguration {
  state: "complete" | "incomplete" | "unavailable";
  revision: number;
  missing_fields: string[];
  unavailable_reason: string | null;
}

/** Lightweight list projection, never a command authorization or CAS baseline. */
export interface SummaryListContentActions {
  contract_version: 1;
  mode: "formal" | "legacy" | "unavailable";
  content_id?: string;
  business_scope: "single" | "team" | "group" | "unknown";
  capabilities: SummaryContentCapabilities;
  generation_config: SummaryContentConfiguration;
  active_generation: { generation_id: string; status: string; can_cancel: boolean } | null;
  unavailable_reason?: string;
}

export interface SummaryFormalVersion {
  content_id: string;
  version_id: string;
  version: number;
  content_revision: number;
  content: string;
  citations: CitationItem[];
  team_citations: TeamCitationItem[];
  citation_visibility: "visible" | "not_generated" | "permission_hidden";
  team_citation_visibility: "none" | "current_report" | "historical_identity_only";
  operation_type: string;
  operation_note: string;
  parent_version_id?: string;
  base_content_revision: number;
  generation_id?: string;
  provisional: boolean;
  is_current: boolean;
  pending_application?: boolean;
  edited_at?: string;
  edited_by?: string;
  restored_from_version_id?: string;
  restored_at?: string;
  generated_at: string;
}

export interface SummaryFormalContent {
  content_id: string;
  kind: "result" | "personal";
  owner_id?: string;
  is_main: boolean;
  content_revision: number;
  current_version: SummaryFormalVersion | null;
  capabilities: SummaryContentCapabilities;
  generation_config: SummaryContentConfiguration;
  active_generation: SummaryContentGeneration | null;
  latest_generation?: SummaryContentGeneration | null;
  integrity: "consistent" | "provisional" | "normalization_required" | "repair_required";
}

export interface SummaryContentCatalog {
  contract_version: 1;
  summary_id: number;
  created_via: "unknown" | "agent" | "workflow";
  main_content_id: string;
  contents: SummaryFormalContent[];
}

export interface SummaryFormalVersionPage {
  items: SummaryFormalVersion[];
  next_cursor: string;
}

export interface SummaryContentBaseline {
  content_id: string;
  expected_current_version_id: string;
  expected_content_revision: number;
}

export interface SummaryContentGeneration {
  generation_id: string;
  space_id: string;
  task_id: number;
  content_id: string;
  operation_type: string;
  executor: string;
  generation_scope: "content" | "task";
  parent_generation_id?: string;
  status: "pending" | "running" | "completed" | "conflict" | "failed" | "cancelled";
  stage: string;
  effective_at: string;
  base_version_id: string;
  base_content_revision: number;
  config_revision: number;
  output_version_id?: string;
  applied: boolean;
  cancel_requested: boolean;
  conflict_reason?: string;
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface SummaryContentRefineRequest extends SummaryContentBaseline {
  feedback: string;
  idempotency_key: string;
}

export interface SummaryGenerationSpec {
  schema_version: 1;
  sources: { source_id: string; source_type: number; confirmation: string }[];
  summary_mode: number;
  collaboration: "single";
  participants: string[];
  time_selector: {
    mode: "absolute" | "relative" | "natural_period" | "incremental";
    timezone: string;
    start?: string; end?: string; days?: number;
    unit?: string; offset?: number; initial_start?: string;
  };
  requirement: string | null;
  template: { id: string; version: string; content: string } | null;
  retrieval: { author_ids: string[]; keywords: string[] };
  citation_rules: { policy: string };
  field_sources: Record<string, string>;
}

export interface SummaryGenerationSchedule {
  enabled: boolean;
  interval_days: number;
  interval_months: number;
  run_time: string;
  day_of_week: number;
  day_of_month: number;
  /** Existing cron rules can be retained or paused, not authored here. */
  cron_expr?: string;
}

export interface SummaryGenerationConfiguration extends SummaryContentConfiguration {
  spec: SummaryGenerationSpec;
  schedule: SummaryGenerationSchedule | null;
  next_run_at: string | null;
}

export interface SummaryRegenerateRequest extends SummaryContentBaseline {
  expected_config_revision: number;
  idempotency_key: string;
  // A one-shot topic that replaces the generation requirement for this run only.
  // It never rewrites the saved configuration (spec/revision) and is excluded
  // from the scheduled series' incremental watermark on the backend.
  requirement_override?: string;
}

export interface SummarySaveConfigurationRequest {
  expected_config_revision: number;
  spec: SummaryGenerationSpec;
  schedule?: SummaryGenerationSchedule;
  generate?: SummaryRegenerateRequest;
}

export interface SummarySavedConfiguration {
  configuration: SummaryGenerationConfiguration;
  generation: SummaryContentGeneration | null;
}

export class SummaryContentProtocolError extends Error {
  readonly code = "invalid_content_contract";
}
