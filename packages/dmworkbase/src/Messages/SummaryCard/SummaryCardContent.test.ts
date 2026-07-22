import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({ t: (key: string) => key }));

import { SummaryCardContent } from "./SummaryCardContent";

describe("SummaryCardContent", () => {
  it("decodes the legacy type-15 payload without crashing", () => {
    const content = new SummaryCardContent();
    content.decodeJSON({
      task_id: 42,
      task_no: "ST42",
      title: "Legacy summary",
      source_count: 2,
      total_msg_count: 38,
      time_range_start: "2026-07-15T00:00:00Z",
      time_range_end: "2026-07-16T00:00:00Z",
      summary_mode: 1,
      space_id: "space-1",
    });
    expect(content.schemaVersion).toBe(1);
    expect(content.shareId).toBe("");
    expect(content.title).toBe("Legacy summary");
  });

  it("round-trips the v2 share fields while retaining legacy fields", () => {
    const content = new SummaryCardContent();
    content.schemaVersion = 2;
    content.taskId = 42;
    content.taskNo = "ST42";
    content.shareId = "grant-token";
    content.title = "Weekly review";
    content.sourceName = "Growth group";
    content.sourceCount = 1;
    content.participantCount = 8;
    content.totalMsgCount = 38;
    content.preview = "Activation improved.";
    content.timeRangeStart = "2026-07-15T00:00:00Z";
    content.timeRangeEnd = "2026-07-16T00:00:00Z";
    content.summaryMode = 1;
    content.spaceId = "space-1";

    const encoded = content.encodeJSON();
    expect(encoded).toMatchObject({
      type: 15,
      schema_version: 2,
      task_id: 42,
      task_no: "ST42",
      share_id: "grant-token",
      source_name: "Growth group",
      participant_count: 8,
    });

    const decoded = new SummaryCardContent();
    decoded.decodeJSON(encoded);
    expect(decoded.shareId).toBe("grant-token");
    expect(decoded.preview).toBe("Activation improved.");
  });
});
