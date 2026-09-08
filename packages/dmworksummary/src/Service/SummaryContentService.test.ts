import { describe, expect, it, vi } from "vitest";
import { SummaryContentService, resolveContentApiURL } from "./SummaryContentService";
import { SummaryContentProtocolError } from "./SummaryContentContract";
import {
  decodeContentCatalog,
  decodeContentGeneration,
  decodeFormalVersion,
  formalContentBaseline,
} from "../bridge/summaryWorkbench/formalContent";

const contentId = "sc1_personal";
const versionId = "sv1_first";
const generationId = "11111111-1111-4111-8111-111111111111";

function generation() {
  return {
    generation_id: generationId, space_id: "space-a", task_id: 12, content_id: contentId,
    operation_type: "refine", executor: "refine", generation_scope: "content", status: "pending",
    stage: "queued", effective_at: "2026-09-08T10:00:00+08:00",
    base_version_id: versionId, base_content_revision: 3, config_revision: 0,
    applied: false, cancel_requested: false, created_at: "2026-09-08T10:00:00+08:00",
    updated_at: "2026-09-08T10:00:00+08:00",
  };
}

function version() {
  return {
    content_id: contentId, version_id: versionId, version: 1, content_revision: 3,
    content: "Report [7] [P7]", citations: [{
      index: 7, sender: "Author", content: "Message", sent_at: "2026-09-08T10:00:00+08:00",
      source: "Group", channel_id: "group", channel_type: 2, message_seq: 31,
      context_before: [{ sender: "Author", content: "Context", sent_at: "2026-09-08T09:59:00+08:00", message_seq: 30 }],
    }],
    team_citations: [{ index: 7, user_id: "member", user_name: "Member" }],
    citation_visibility: "visible", team_citation_visibility: "current_report",
    operation_type: "generate", operation_note: "", base_content_revision: 0,
    provisional: false, is_current: true, generated_at: "2026-09-08T10:01:00+08:00",
  };
}

function catalog() {
  return {
    contract_version: 1, summary_id: 12, created_via: "unknown", main_content_id: contentId,
    contents: [{
      content_id: contentId, kind: "personal", owner_id: "owner", is_main: true,
      content_revision: 3, current_version: version(), active_generation: null, integrity: "consistent",
      capabilities: {
        can_edit: false, can_refine: false, can_save_as_new: false,
        can_configure_schedule: false, can_schedule: false,
        can_regenerate_direct: false, can_regenerate_with_config: false,
        can_view_versions: true, can_delete: false,
        unavailable_reasons: { edit: "write_protocol_not_enabled" },
      },
      generation_config: {
        state: "unavailable", revision: 0, missing_fields: [],
        unavailable_reason: "configuration_adapter_not_enabled",
      },
    }],
  };
}

describe("SummaryContentService compatibility reads", () => {
  it("passes explicit Space and abort signal through the HTTP boundary", async () => {
    const read = vi.fn().mockResolvedValue({ code: 0, data: catalog() });
    const service = new SummaryContentService({ read });
    const options = { spaceId: "space-a", signal: new AbortController().signal };
    const result = await service.loadContents(12, options);
    expect(read).toHaveBeenCalledWith("/summary/api/v1/summaries/12/contents", options);
    expect(result.contents[0].content_revision).toBe(3);
    expect(result.contents[0].capabilities.can_edit).toBe(false);
  });

  it("keeps formal pagination separate from the old five-version API", async () => {
    const read = vi.fn().mockResolvedValue({ code: 0, data: { items: [version()], next_cursor: "sp1_next" } });
    const service = new SummaryContentService({ read });
    const options = { spaceId: "space-a" };
    await service.loadVersions(12, contentId, options);
    expect(read).toHaveBeenCalledWith(
      `/summary/api/v1/summaries/12/contents/${contentId}/versions`, options, { cursor: "", limit: 20 }
    );
    await service.loadVersions(12, contentId, options, { cursor: "sp1_next", limit: 6 });
    expect(read).toHaveBeenLastCalledWith(
      `/summary/api/v1/summaries/12/contents/${contentId}/versions`, options, { cursor: "sp1_next", limit: 6 }
    );
  });

  it("rejects preview IDs, missing Space and invalid limits before transport", async () => {
    const read = vi.fn();
    const service = new SummaryContentService({ read });
    await expect(service.loadContents(12, { spaceId: "" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    await expect(service.loadVersions(12, "12", { spaceId: "s" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    await expect(service.loadVersion(12, contentId, "artifact-1", { spaceId: "s" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    await expect(service.loadVersions(12, contentId, { spaceId: "s" }, { limit: 101 })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects another summary, content or version in the response", async () => {
    const read = vi.fn().mockResolvedValue(catalog());
    const service = new SummaryContentService({ read });
    await expect(service.loadContents(13, { spaceId: "s" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    read.mockResolvedValue(version());
    await expect(service.loadVersion(12, "sc1_other", versionId, { spaceId: "s" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
    await expect(service.loadVersion(12, contentId, "sv1_other", { spaceId: "s" })).rejects.toBeInstanceOf(SummaryContentProtocolError);
  });

  it("preserves real indices and both evidence namespaces, including context", () => {
    const decoded = decodeFormalVersion(version(), contentId);
    expect(decoded.citations[0].index).toBe(7);
    expect(decoded.citations[0].message_seq).toBe(31);
    expect(decoded.citations[0].context_before?.[0].message_seq).toBe(30);
    expect(decoded.team_citations[0].index).toBe(7);
    expect(decoded.team_citations[0].user_id).toBe("member");
  });

  it("fails closed when hidden evidence or historical report links are present", () => {
    expect(() => decodeFormalVersion({ ...version(), citation_visibility: "permission_hidden" }, contentId))
      .toThrow(SummaryContentProtocolError);
    expect(() => decodeFormalVersion({
      ...version(), team_citation_visibility: "historical_identity_only",
      team_citations: [{ index: 7, user_id: "member", user_name: "Member", personal_result_id: 99 }],
    }, contentId)).toThrow(SummaryContentProtocolError);
  });

  it("derives mutation baselines only from consistent formal content", () => {
    const decoded = decodeContentCatalog(catalog(), 12).contents[0];
    expect(formalContentBaseline(decoded)).toEqual({
      content_id: contentId, expected_current_version_id: versionId, expected_content_revision: 3,
    });
    expect(formalContentBaseline({ ...decoded, integrity: "normalization_required" })).toBeNull();
    expect(formalContentBaseline({
      ...decoded, integrity: "normalization_required", capabilities: { ...decoded.capabilities, can_edit: true },
    })?.expected_content_revision).toBe(3);
    expect(formalContentBaseline({ ...decoded, current_version: null })).toBeNull();
  });

  it("rejects inconsistent current revisions and duplicate catalog identities", () => {
    const mismatch = catalog();
    mismatch.contents[0].content_revision = 99;
    expect(() => decodeContentCatalog(mismatch, 12)).toThrow(SummaryContentProtocolError);
    const duplicate = catalog();
    duplicate.contents.push(duplicate.contents[0]);
    expect(() => decodeContentCatalog(duplicate, 12)).toThrow(SummaryContentProtocolError);
  });

  it("resolves the summary origin for browser, Electron and extension hosts", () => {
    const path = "/summary/api/v1/summaries/12/contents";
    expect(resolveContentApiURL(path, "/api/v1/", "http://localhost:28140"))
      .toBe(`http://localhost:28140${path}`);
    expect(resolveContentApiURL(path, "https://octo.example/api/v1/", "chrome-extension://example"))
      .toBe(`https://octo.example${path}`);
    expect(() => resolveContentApiURL(path, "", "chrome-extension://example")).toThrow();
  });
});

describe("SummaryContentService coordinated commands", () => {
  const baseline = {
    content_id: contentId, expected_current_version_id: versionId, expected_content_revision: 3,
  };
  const options = { spaceId: "space-a", signal: new AbortController().signal };
  const root = `/summary/api/v1/summaries/12/contents/${contentId}`;

  it("sends edit and restore baselines without rewriting citation identities", async () => {
    const command = vi.fn().mockResolvedValue({ ...version(), content_revision: 4 });
    const service = new SummaryContentService({ read: vi.fn(), command });
    await service.editCurrent(12, baseline, "edited [7] [P7]", options);
    expect(command).toHaveBeenLastCalledWith(`${root}/edit`, options, {
      expected_current_version_id: versionId, expected_content_revision: 3, content: "edited [7] [P7]",
    });
    await service.restoreCurrent(12, baseline, "sv1_history", options);
    expect(command).toHaveBeenLastCalledWith(`${root}/restore`, options, {
      expected_current_version_id: versionId, expected_content_revision: 3, source_version_id: "sv1_history",
    });
  });

  it("preserves the same idempotency key on refinement retry", async () => {
    const command = vi.fn().mockResolvedValue(generation());
    const service = new SummaryContentService({ read: vi.fn(), command });
    const request = { ...baseline, idempotency_key: "retry-stable-key", feedback: "Make concise" };
    const first = await service.refineCurrent(12, request, options);
    const retry = await service.refineCurrent(12, request, options);
    expect(first.generation_id).toBe(retry.generation_id);
    expect(command).toHaveBeenNthCalledWith(2, `${root}/generations/refine`, options, {
      expected_current_version_id: versionId, expected_content_revision: 3,
      idempotency_key: "retry-stable-key", feedback: "Make concise",
    });
  });

  it("loads, cancels and applies a persisted run with explicit Space", async () => {
    const read = vi.fn().mockResolvedValue(generation());
    const command = vi.fn().mockResolvedValue({ ...generation(), status: "cancelled", cancel_requested: true });
    const service = new SummaryContentService({ read, command });
    await service.loadGeneration(12, contentId, generationId, options);
    expect(read).toHaveBeenCalledWith(`${root}/generations/${generationId}`, options);
    await service.cancelGeneration(12, contentId, generationId, options);
    expect(command).toHaveBeenLastCalledWith(`${root}/generations/${generationId}/cancel`, options, {});
    command.mockResolvedValue({ ...version(), version_id: "sv1_candidate", content_revision: 4 });
    await service.applyCandidate(12, baseline, generationId, options);
    expect(command).toHaveBeenLastCalledWith(`${root}/generations/${generationId}/apply`, options, {
      expected_current_version_id: versionId, expected_content_revision: 3,
    });
  });

  it("rejects preview/stale identities, missing revisions and missing retry keys before transport", async () => {
    const command = vi.fn();
    const read = vi.fn();
    const service = new SummaryContentService({ read, command });
    await expect(service.editCurrent(12, { ...baseline, expected_content_revision: 0 }, "edit", options)).rejects.toThrow(SummaryContentProtocolError);
    await expect(service.restoreCurrent(12, baseline, versionId, options)).rejects.toThrow(SummaryContentProtocolError);
    await expect(service.refineCurrent(12, { ...baseline, feedback: "short", idempotency_key: "" }, options)).rejects.toThrow(SummaryContentProtocolError);
    await expect(service.cancelGeneration(12, contentId, "preview-1", options)).rejects.toThrow(SummaryContentProtocolError);
    await expect(new SummaryContentService({ read }).editCurrent(12, baseline, "edit", options)).rejects.toThrow(SummaryContentProtocolError);
    expect(command).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("decodes reloadable runs without retaining private input or cross-Space responses", () => {
    const response = catalog();
    const decoded = decodeContentCatalog({
      ...response, contents: [{ ...response.contents[0], active_generation: generation() }],
    }, 12);
    expect(decoded.contents[0].active_generation?.generation_id).toBe(generationId);
    const expected = { summaryId: 12, contentId, spaceId: "space-a" };
    expect(decodeContentGeneration({
      ...generation(), input_json: { content: "private" }, execution_token: 99,
    }, expected)).not.toHaveProperty("input_json");
    expect(() => decodeContentGeneration({ ...generation(), space_id: "other" }, expected)).toThrow(SummaryContentProtocolError);
    expect(() => decodeContentGeneration({ ...generation(), content_id: "sc1_other" }, expected)).toThrow(SummaryContentProtocolError);
    expect(() => decodeContentGeneration({ ...generation(), status: "conflict" }, expected)).toThrow(SummaryContentProtocolError);
  });

  it("rejects a successful command response with a stale revision or historical row", async () => {
    const command = vi.fn().mockResolvedValue(version());
    const service = new SummaryContentService({ read: vi.fn(), command });
    await expect(service.editCurrent(12, baseline, "edit", options)).rejects.toThrow(SummaryContentProtocolError);
    command.mockResolvedValue({ ...version(), content_revision: 4, is_current: false });
    await expect(service.applyCandidate(12, baseline, generationId, options)).rejects.toThrow(SummaryContentProtocolError);
  });
});
