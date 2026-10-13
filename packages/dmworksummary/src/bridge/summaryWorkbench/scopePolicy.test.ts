import { describe, expect, it } from "vitest";
import type { SummaryWorkbenchScope } from "./protocol";
import {
  maxSelectableChats,
  maxSelectableDocuments,
  summaryWorkbenchScopeIssues,
  summaryWorkbenchSourceCount,
} from "./scopePolicy";

function scope(
  chatCount: number,
  documentCount: number
): SummaryWorkbenchScope {
  return {
    selectedChannels: Array.from({ length: chatCount }, (_, index) => ({
      chatId: `chat-${index}`,
      chatType: "group" as const,
      name: `Chat ${index}`,
    })),
    documents: Array.from({ length: documentCount }, (_, index) => ({
      documentId: `doc-${index}`,
      title: `Document ${index}`,
    })),
    participants: [],
    template: null,
    timeRange: null,
    referencedTaskIds: [],
  };
}

describe("summary workbench scope policy", () => {
  it("allows 30 deduplicated mixed sources and rejects 31", () => {
    expect(
      summaryWorkbenchScopeIssues(scope(20, 10), { mixedSources: true })
    ).toEqual([]);
    expect(
      summaryWorkbenchScopeIssues(scope(21, 10), { mixedSources: true })
    ).toContain("mixed_source_limit_exceeded");
  });

  it("counts duplicate source ids only once", () => {
    const value = scope(20, 10);
    value.selectedChannels.push(value.selectedChannels[0]);
    value.documents?.push(value.documents[0]);
    expect(summaryWorkbenchSourceCount(value)).toBe(30);
    expect(summaryWorkbenchScopeIssues(value, { mixedSources: true })).toEqual(
      []
    );
  });

  it("derives picker limits from the opposite mixed-source selection", () => {
    expect(maxSelectableChats(scope(0, 10), { mixedSources: true })).toBe(20);
    expect(maxSelectableDocuments(scope(25, 0), { mixedSources: true })).toBe(
      5
    );
    expect(maxSelectableDocuments(scope(0, 0), { mixedSources: true })).toBe(
      10
    );
  });

  it("keeps independent picker limits when mixed sources are disabled", () => {
    expect(maxSelectableChats(scope(0, 10), { mixedSources: false })).toBe(30);
    expect(maxSelectableDocuments(scope(30, 0), { mixedSources: false })).toBe(
      10
    );
  });

  it("reports every backend-incompatible shape from one policy", () => {
    const value = {
      ...scope(1, 1),
      participants: [{ userId: "user-1" }],
      referencedTaskIds: [7],
    };
    expect(summaryWorkbenchScopeIssues(value, { mixedSources: false })).toEqual(
      [
        "mixed_sources_disabled",
        "documents_with_participants",
        "mixed_with_reference",
      ]
    );

    expect(
      summaryWorkbenchScopeIssues(
        {
          ...scope(0, 1),
          timeRange: { start: "a", end: "b", label: "Range" },
        },
        { mixedSources: true }
      )
    ).toContain("document_only_time_range");
  });
});
