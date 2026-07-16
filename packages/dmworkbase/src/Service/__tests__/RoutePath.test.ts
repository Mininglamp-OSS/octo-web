import { describe, expect, it } from "vitest";
import { normalizeRoutePath } from "../RoutePath";

describe("normalizeRoutePath", () => {
  it("keeps the root route as root", () => {
    expect(normalizeRoutePath("/")).toBe("/");
    expect(normalizeRoutePath("")).toBe("/");
    expect(normalizeRoutePath(undefined)).toBe("/");
  });

  it("removes trailing slashes from non-root routes", () => {
    expect(normalizeRoutePath("/appbot/")).toBe("/appbot");
    expect(normalizeRoutePath("/appbot///")).toBe("/appbot");
  });

  it("adds the leading slash when callers pass a bare route", () => {
    expect(normalizeRoutePath("appbot")).toBe("/appbot");
  });

  it("drops query and hash fragments before matching route handlers", () => {
    expect(normalizeRoutePath("/appbot/?sid=abc")).toBe("/appbot");
    expect(normalizeRoutePath("/appbot#section")).toBe("/appbot");
  });
});
