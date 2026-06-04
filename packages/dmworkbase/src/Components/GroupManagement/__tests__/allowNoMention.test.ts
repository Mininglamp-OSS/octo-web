import { describe, expect, it } from "vitest";
import {
  readAllowNoMention,
  shouldApplyFetchResult,
  shouldListenerApply,
} from "../allowNoMention";

describe("readAllowNoMention", () => {
  it("returns false only when server explicitly sends 0 (switch OFF)", () => {
    expect(readAllowNoMention({ allow_no_mention: 0 })).toBe(false);
  });

  it("returns true when server sends 1 (switch ON)", () => {
    expect(readAllowNoMention({ allow_no_mention: 1 })).toBe(true);
  });

  it("defaults to true when field missing (old backend, zero-regression)", () => {
    expect(readAllowNoMention({})).toBe(true);
  });

  it("defaults to true when orgData is undefined", () => {
    expect(readAllowNoMention(undefined)).toBe(true);
  });

  it("defaults to true when orgData is null", () => {
    expect(readAllowNoMention(null)).toBe(true);
  });
});

describe("shouldApplyFetchResult (round2 stale-fetch race guard)", () => {
  it("applies when this fetch is still the latest op and not saving", () => {
    expect(shouldApplyFetchResult(2, 2, false)).toBe(true);
  });

  it("drops a stale mount-fetch that a newer toggle has superseded", () => {
    // mount fetch (op 1) resolves after a toggle bumped opSeq to 2 → discard.
    expect(shouldApplyFetchResult(1, 2, false)).toBe(false);
  });

  it("drops the result while a save is in flight (optimistic value wins)", () => {
    expect(shouldApplyFetchResult(3, 3, true)).toBe(false);
  });
});

describe("shouldListenerApply (round2 listener write-back guard)", () => {
  it("applies external channel updates when no fetch in flight and not saving", () => {
    expect(shouldListenerApply(0, false)).toBe(true);
  });

  it("ignores listener while our own fetch is in flight (avoids self-overwrite)", () => {
    expect(shouldListenerApply(1, false)).toBe(false);
  });

  it("ignores listener while saving (optimistic toggle value wins)", () => {
    expect(shouldListenerApply(0, true)).toBe(false);
  });
});

