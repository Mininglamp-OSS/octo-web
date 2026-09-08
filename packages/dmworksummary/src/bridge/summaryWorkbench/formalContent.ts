import type { CitationContextMessage, CitationItem, TeamCitationItem } from "../../types/summary";
import {
  SummaryContentProtocolError,
  type SummaryContentBaseline,
  type SummaryContentCapabilities,
  type SummaryContentCatalog,
  type SummaryContentConfiguration,
  type SummaryContentGeneration,
  type SummaryFormalContent,
  type SummaryFormalVersion,
  type SummaryFormalVersionPage,
} from "../../Service/SummaryContentContract";

function invalid(): never {
  throw new SummaryContentProtocolError("Unsupported or inconsistent formal content response");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return Object.fromEntries(Object.entries(value));
}

function body(value: unknown): Record<string, unknown> {
  const object = record(value);
  if ("code" in object) {
    if (object.code !== 0) return invalid();
    return record(object.data);
  }
  return object;
}

function text(value: unknown): string {
  if (typeof value !== "string") return invalid();
  return value;
}

function count(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return invalid();
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value);
}

function contentToken(value: unknown, prefix: "sc1_" | "sv1_"): string {
  const token = text(value);
  if (!token.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(token) || token.length <= prefix.length) return invalid();
  return token;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}

function capabilities(value: unknown): SummaryContentCapabilities {
  const v = record(value);
  const reasons: Record<string, string> = {};
  for (const [key, reason] of Object.entries(record(v.unavailable_reasons))) reasons[key] = text(reason);
  return {
    can_edit: flag(v.can_edit), can_refine: flag(v.can_refine),
    can_save_as_new: flag(v.can_save_as_new), can_configure_schedule: flag(v.can_configure_schedule),
    can_schedule: flag(v.can_schedule), can_regenerate_direct: flag(v.can_regenerate_direct),
    can_regenerate_with_config: flag(v.can_regenerate_with_config),
    can_view_versions: flag(v.can_view_versions), can_delete: flag(v.can_delete),
    unavailable_reasons: reasons,
  };
}

function configuration(value: unknown): SummaryContentConfiguration {
  const v = record(value);
  if (v.state !== "complete" && v.state !== "incomplete" && v.state !== "unavailable") return invalid();
  return {
    state: v.state, revision: count(v.revision), missing_fields: array(v.missing_fields).map(text),
    unavailable_reason: v.unavailable_reason === null ? null : text(v.unavailable_reason),
  };
}

function citation(value: unknown): CitationItem {
  const c = record(value);
  // Reuse the existing message citation contract, preserving persistent
  // indices rather than display-order labels.
  return {
    index: count(c.index, 1),
    sender: text(c.sender),
    sender_uid: optionalText(c.sender_uid),
    content: text(c.content),
    sent_at: text(c.sent_at),
    source: text(c.source),
    channel_id: optionalText(c.channel_id),
    message_seq: c.message_seq === undefined ? undefined : count(c.message_seq),
    channel_type: c.channel_type === undefined ? undefined : count(c.channel_type),
    context_before: c.context_before === undefined ? undefined : array(c.context_before).map(contextMessage),
    context_after: c.context_after === undefined ? undefined : array(c.context_after).map(contextMessage),
  };
}

function contextMessage(value: unknown): CitationContextMessage {
  const c = record(value);
  return {
    sender: text(c.sender), sender_uid: optionalText(c.sender_uid),
    content: text(c.content), sent_at: text(c.sent_at),
    message_seq: c.message_seq === undefined ? undefined : count(c.message_seq),
  };
}

function teamCitation(value: unknown): TeamCitationItem {
  const c = record(value);
  return {
    index: count(c.index, 1), user_id: text(c.user_id), user_name: text(c.user_name),
    ...(c.personal_result_id === undefined ? {} : { personal_result_id: count(c.personal_result_id, 1) }),
    ...(c.task_id === undefined ? {} : { task_id: count(c.task_id, 1) }),
  };
}

export function decodeFormalVersion(value: unknown, expectedContentId: string): SummaryFormalVersion {
  const v = body(value);
  if (v.content_id !== expectedContentId) return invalid();
  const visibility = v.citation_visibility;
  const teamVisibility = v.team_citation_visibility;
  if (visibility !== "visible" && visibility !== "not_generated" && visibility !== "permission_hidden") return invalid();
  if (teamVisibility !== "none" && teamVisibility !== "current_report" && teamVisibility !== "historical_identity_only") return invalid();
  const citations = array(v.citations).map(citation);
  const team = array(v.team_citations).map(teamCitation);
  if (visibility === "permission_hidden" && citations.length > 0) return invalid();
  if (teamVisibility === "historical_identity_only" &&
      team.some((c) => c.personal_result_id !== undefined || c.task_id !== undefined)) return invalid();
  if (v.pending_application === true && (v.is_current === true || !v.generation_id)) return invalid();
  return {
    content_id: contentToken(v.content_id, "sc1_"), version_id: contentToken(v.version_id, "sv1_"),
    version: count(v.version, 1), content_revision: count(v.content_revision),
    content: text(v.content), citations, team_citations: team,
    citation_visibility: visibility, team_citation_visibility: teamVisibility,
    operation_type: text(v.operation_type), operation_note: text(v.operation_note),
    parent_version_id: v.parent_version_id === undefined ? undefined : contentToken(v.parent_version_id, "sv1_"),
    base_content_revision: count(v.base_content_revision),
    generation_id: optionalText(v.generation_id),
    provisional: flag(v.provisional), is_current: flag(v.is_current),
    pending_application: v.pending_application === undefined ? false : flag(v.pending_application),
    edited_at: optionalText(v.edited_at), edited_by: optionalText(v.edited_by),
    restored_from_version_id: v.restored_from_version_id === undefined ? undefined : contentToken(v.restored_from_version_id, "sv1_"),
    restored_at: optionalText(v.restored_at), generated_at: text(v.generated_at),
  };
}

export function decodeContentGeneration(
  value: unknown,
  expected: { summaryId: number; contentId: string; spaceId?: string; generationId?: string; allowTaskScope?: boolean }
): SummaryContentGeneration {
  const v = body(value);
  if (typeof v.generation_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v.generation_id)) return invalid();
  if (v.generation_scope !== "content" && v.generation_scope !== "task") return invalid();
  if (v.task_id !== expected.summaryId ||
      (v.content_id !== expected.contentId && !(expected.allowTaskScope && v.generation_scope === "task")) ||
      (expected.spaceId !== undefined && v.space_id !== expected.spaceId) ||
      (expected.generationId !== undefined && v.generation_id !== expected.generationId)) return invalid();
  if (v.status !== "pending" && v.status !== "running" && v.status !== "completed" &&
      v.status !== "conflict" && v.status !== "failed" && v.status !== "cancelled") return invalid();
  const output = v.output_version_id === undefined ? undefined : contentToken(v.output_version_id, "sv1_");
  const applied = flag(v.applied);
  if ((v.status === "conflict" && (!output || applied)) ||
      ((v.status === "pending" || v.status === "running") && (output || applied)) ||
      (v.generation_scope === "content" && v.status === "completed" && (!output || !applied)) ||
      ((v.status === "failed" || v.status === "cancelled") && applied)) return invalid();
  return {
    generation_id: text(v.generation_id), space_id: text(v.space_id), task_id: count(v.task_id, 1),
    content_id: contentToken(v.content_id, "sc1_"), operation_type: text(v.operation_type), executor: text(v.executor),
    generation_scope: v.generation_scope, parent_generation_id: optionalText(v.parent_generation_id),
    status: v.status, stage: text(v.stage), effective_at: text(v.effective_at),
    base_version_id: contentToken(v.base_version_id, "sv1_"), base_content_revision: count(v.base_content_revision),
    config_revision: count(v.config_revision), output_version_id: output, applied,
    cancel_requested: flag(v.cancel_requested), conflict_reason: optionalText(v.conflict_reason),
    error_code: optionalText(v.error_code), created_at: text(v.created_at), updated_at: text(v.updated_at),
  };
}

function content(value: unknown, summaryId: number): SummaryFormalContent {
  const c = record(value);
  const id = contentToken(c.content_id, "sc1_");
  if (c.kind !== "result" && c.kind !== "personal") return invalid();
  if (c.integrity !== "consistent" && c.integrity !== "provisional" &&
      c.integrity !== "normalization_required" && c.integrity !== "repair_required") return invalid();
  const active = c.active_generation === null ? null : decodeContentGeneration(c.active_generation, {
    summaryId, contentId: id, allowTaskScope: true,
  });
  if (active && active.status !== "pending" && active.status !== "running") return invalid();
  const current = c.current_version === null ? null : decodeFormalVersion(c.current_version, id);
  const revision = count(c.content_revision);
  if (current && (!current.is_current || current.content_revision !== revision)) return invalid();
  return {
    content_id: id, kind: c.kind, owner_id: optionalText(c.owner_id), is_main: flag(c.is_main),
    content_revision: revision, current_version: current,
    capabilities: capabilities(c.capabilities), generation_config: configuration(c.generation_config),
    active_generation: active, integrity: c.integrity,
  };
}

export function decodeContentCatalog(value: unknown, expectedSummaryId: number): SummaryContentCatalog {
  const v = body(value);
  if (v.contract_version !== 1 || v.summary_id !== expectedSummaryId ||
      (v.created_via !== "unknown" && v.created_via !== "agent" && v.created_via !== "workflow")) return invalid();
  const contents = array(v.contents).map((item) => content(item, expectedSummaryId));
  const mainId = contentToken(v.main_content_id, "sc1_");
  if (new Set(contents.map((c) => c.content_id)).size !== contents.length ||
      contents.filter((c) => c.is_main).length !== 1 ||
      !contents.some((c) => c.is_main && c.content_id === mainId)) return invalid();
  return {
    contract_version: 1, summary_id: count(v.summary_id, 1),
    created_via: v.created_via, main_content_id: mainId, contents,
  };
}

export function decodeFormalVersionPage(value: unknown, contentId: string): SummaryFormalVersionPage {
  const v = body(value);
  const items = array(v.items).map((item) => decodeFormalVersion(item, contentId));
  if (new Set(items.map((item) => item.version_id)).size !== items.length) return invalid();
  return { items, next_cursor: text(v.next_cursor) };
}

/** No preview, reference-task ID or display citation number can become a CAS baseline. */
export function formalContentBaseline(content: SummaryFormalContent): SummaryContentBaseline | null {
  const canNormalize = content.integrity === "normalization_required" &&
    (content.capabilities.can_edit || content.capabilities.can_refine);
  if (!content.current_version ||
      (content.integrity !== "consistent" && content.integrity !== "provisional" && !canNormalize)) return null;
  return {
    content_id: content.content_id,
    expected_current_version_id: content.current_version.version_id,
    expected_content_revision: content.content_revision,
  };
}
