import { describe, expect, it } from "vitest";
import {
  getProfileContactInfo,
  phoneWithoutCountryCode,
  truncateContactEmail,
} from "../profileContactInfo";

describe("profile contact info", () => {
  it("keeps an explicitly empty field distinct from withheld or malformed data", () => {
    expect(getProfileContactInfo({ phone: "", email: "" })).toEqual({
      phone: { kind: "empty" },
      email: { kind: "empty" },
    });
    expect(getProfileContactInfo({})).toEqual({
      phone: undefined,
      email: undefined,
    });
    expect(
      getProfileContactInfo({ phone: null, email: "not-an-email" })
    ).toEqual({
      phone: undefined,
      email: undefined,
    });
  });

  it("accepts valid profile contacts without coercing server values", () => {
    expect(
      getProfileContactInfo({
        phone: "+86 13800138000",
        email: "alice@example.com",
      })
    ).toEqual({
      phone: { kind: "value", value: "+86 13800138000" },
      email: { kind: "value", value: "alice@example.com" },
    });
  });

  it("removes the country code only for another user's card", () => {
    expect(phoneWithoutCountryCode("+86 13800138000")).toBe("13800138000");
    expect(
      phoneWithoutCountryCode("+1 2025550100", { phone_country_code: "1" })
    ).toBe("2025550100");
  });

  it("ellipsizes email after the product maximum", () => {
    const email = `${"a".repeat(95)}@example.com`;
    expect(truncateContactEmail(email)).toHaveLength(100);
    expect(truncateContactEmail(email)).toMatch(/…$/);
  });
});
