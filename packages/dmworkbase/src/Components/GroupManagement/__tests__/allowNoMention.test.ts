import { describe, expect, it } from "vitest";
import { readAllowNoMention } from "../allowNoMention";

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
