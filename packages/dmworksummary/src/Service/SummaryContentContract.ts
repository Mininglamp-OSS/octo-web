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
  // The compatibility-read phase never advertises a generation it cannot
  // recover. The run protocol will be introduced with the coordinated writers.
  active_generation: null;
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

export class SummaryContentProtocolError extends Error {
  readonly code = "invalid_content_contract";
}
