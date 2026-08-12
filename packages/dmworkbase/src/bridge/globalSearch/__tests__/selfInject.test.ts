import { describe, expect, it } from "vitest";
import { buildSelfContactEntry, shouldInjectSelf } from "../selfInject";

// Behavior tests for the "search hits self" contacts injection helpers.
//
// Locks in the RC-1368 Jerry-Xin blocker fix: the match must be
// trim() + toLowerCase() so a user named "Alice" searching "alice"
// (or "Alice ") gets their self-entry injected, matching the rest of
// the search stack (createGlobalSearchDataSource keyword normalization
// and backend /search/global's utf8mb4 collation-based LIKE).
//
// Also verifies the entry is RAW-name (no <mark>) so the tab-contacts
// renderer stays the single highlighting authority — avoiding the
// <mark><mark>...</mark></mark> double-wrap the pre-marked variant risked.

describe("shouldInjectSelf", () => {
  it("returns true for an exact keyword match", () => {
    expect(shouldInjectSelf("Alice", "Alice")).toBe(true);
  });

  it("returns true for a substring match", () => {
    expect(shouldInjectSelf("li", "Alice")).toBe(true);
  });

  it("returns true for mixed-case keywords (case-insensitive, RC-1368 blocker)", () => {
    expect(shouldInjectSelf("alice", "Alice")).toBe(true);
    expect(shouldInjectSelf("ALICE", "Alice")).toBe(true);
    expect(shouldInjectSelf("aLiCe", "Alice")).toBe(true);
  });

  it("returns true when the keyword has surrounding whitespace (trim)", () => {
    expect(shouldInjectSelf("  alice  ", "Alice")).toBe(true);
    expect(shouldInjectSelf("\tAlice\n", "Alice")).toBe(true);
  });

  it("returns true when selfName has surrounding whitespace", () => {
    // selfDisplayName() from server may sometimes carry padding
    expect(shouldInjectSelf("alice", "  Alice  ")).toBe(true);
  });

  it("returns true for CJK (no case distinction, but trim still applies)", () => {
    expect(shouldInjectSelf("张", "张三")).toBe(true);
    expect(shouldInjectSelf("  张 ", "张三")).toBe(true);
  });

  it("returns false when keyword is empty", () => {
    expect(shouldInjectSelf("", "Alice")).toBe(false);
  });

  it("returns false when keyword is whitespace-only", () => {
    expect(shouldInjectSelf("   ", "Alice")).toBe(false);
    expect(shouldInjectSelf("\t\n", "Alice")).toBe(false);
  });

  it("returns false when selfName is empty or undefined", () => {
    expect(shouldInjectSelf("alice", "")).toBe(false);
    expect(shouldInjectSelf("alice", undefined)).toBe(false);
  });

  it("returns false when keyword is undefined", () => {
    expect(shouldInjectSelf(undefined, "Alice")).toBe(false);
  });

  it("returns false when the keyword does not appear in selfName", () => {
    expect(shouldInjectSelf("bob", "Alice")).toBe(false);
    expect(shouldInjectSelf("李四", "张三")).toBe(false);
  });
});

describe("buildSelfContactEntry", () => {
  it("produces a Contacts-tab friend entry with raw name (no <mark>)", () => {
    // The renderer (tab-contacts.tsx renderItem) is the sole highlight
    // authority: pre-wrapping <mark> here would cause double-wrap when
    // the renderer scans the same substring inside our marked value.
    const entry = buildSelfContactEntry("self-uid", "Alice", 1);
    expect(entry).toEqual({
      channel_id: "self-uid",
      channel_type: 1,
      channel_name: "Alice",
      channel_remark: "",
    });
  });

  it("passes through selfName verbatim — no HTML escape / no <mark>", () => {
    // HTML-hostile names are handled by sanitizeHighlight on the
    // tab-contacts render boundary; the helper stays a passthrough so
    // there's a single documented sanitize authority.
    const entry = buildSelfContactEntry("u1", "<img src=x>Alice", 1);
    expect(entry.channel_name).toBe("<img src=x>Alice");
  });

  it("respects the provided channelType (usually ChannelTypePerson=1)", () => {
    const entry = buildSelfContactEntry("u1", "Alice", 1);
    expect(entry.channel_type).toBe(1);
  });

  it("leaves channel_remark empty so the VM's remark-override loop is a no-op", () => {
    // GlobalSearchVM.requestSearch() overrides channel_name from
    // channel_remark when the latter is non-empty; empty keeps our raw
    // name intact.
    const entry = buildSelfContactEntry("u1", "Alice", 1);
    expect(entry.channel_remark).toBe("");
  });
});
