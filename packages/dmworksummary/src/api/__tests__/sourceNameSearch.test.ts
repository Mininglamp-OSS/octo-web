import { describe, it, expect, vi, beforeEach } from "vitest";
const search = vi.hoisted(() => ({
  searchContacts: vi.fn(),
  searchGroups: vi.fn(),
  searchThreads: vi.fn(),
}));
vi.mock("@octo/base", () => ({ NameSearchService: search }));
import {
  searchSummaryMembers,
  searchSummarySources,
} from "../sourceNameSearch";
describe("summary name candidates", () => {
  beforeEach(() => {
    Object.values(search).forEach((fn) => fn.mockReset());
  });
  it("uses server-owned member eligibility with captured Space and thread context", async () => {
    const page = { items: [{ id: "person" }], nextCursor: "next" };
    search.searchContacts.mockResolvedValue(page);
    const controller = new AbortController();
    expect(
      await searchSummaryMembers(
        {
          keyword: "x",
          spaceId: "A",
          channelId: "g____s",
          channelType: 5,
          cursor: "cursor",
        },
        controller.signal
      )
    ).toBe(page);
    expect(search.searchContacts).toHaveBeenCalledWith(
      {
        keyword: "x",
        spaceId: "A",
        channelId: "g____s",
        channelType: 5,
        cursor: "cursor",
        entry: "name_selector",
        scope: "summary_member",
        contactType: "human",
      },
      controller.signal
    );
  });
  it.each(["contact", "group", "thread"] as const)(
    "keeps %s source pages in authoritative order",
    async (kind) => {
      const method =
        kind === "contact"
          ? search.searchContacts
          : kind === "group"
          ? search.searchGroups
          : search.searchThreads;
      const page = { items: [{ id: "second" }, { id: "first" }], total: 2 };
      method.mockResolvedValue(page);
      expect(
        await searchSummarySources(kind, {
          keyword: "向",
          spaceId: "A",
          includeArchived: kind === "thread",
        })
      ).toBe(page);
      expect(method).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: "name_selector",
          scope: "summary_source",
        }),
        undefined
      );
    }
  );
  it("applies archived eligibility only to thread sources", async () => {
    search.searchGroups.mockResolvedValue({ items: [] });
    await searchSummarySources("group", {
      keyword: "向",
      spaceId: "A",
      includeArchived: true,
    });
    expect(search.searchGroups).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: false }),
      undefined
    );
  });
  it("propagates failure instead of falling back to an unrestricted roster", async () => {
    search.searchThreads.mockRejectedValue(new Error("denied"));
    await expect(
      searchSummarySources("thread", { keyword: "向", spaceId: "A" })
    ).rejects.toThrow("denied");
    expect(search.searchContacts).not.toHaveBeenCalled();
  });
});
