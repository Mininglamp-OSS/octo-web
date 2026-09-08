import { describe, expect, it, vi } from "vitest";
import { SummaryContentService, resolveContentApiURL } from "./SummaryContentService";
import { SummaryContentProtocolError } from "./SummaryContentContract";
import {
  decodeContentCatalog,
  decodeFormalVersion,
  formalContentBaseline,
} from "../bridge/summaryWorkbench/formalContent";

const contentId = "sc1_personal";
const versionId = "sv1_first";

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
