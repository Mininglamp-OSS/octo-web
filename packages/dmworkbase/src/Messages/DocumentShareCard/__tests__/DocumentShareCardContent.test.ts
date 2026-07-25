import { describe, expect, it } from "vitest";
import { isValidDocIdentifier, asDocIdentifier, buildDocNavUrl, permissionState } from "../docIdentity";

describe("isValidDocIdentifier — path-injection allowlist (P1-a)", () => {
  it.each(["d_q3_product_plan", "abc-123", "D1", "a_b-C9"])("accepts %s", (v) => {
    expect(isValidDocIdentifier(v)).toBe(true);
  });

  it.each([
    "../admin", // path traversal
    "a/b", // slash → other endpoint
    "a b", // whitespace
    "a:b", // scheme-ish
    "a?b", // query break
    "a%2e%2e", // encoded traversal (% not allowed)
    "", // empty
    "x".repeat(129), // over length cap
  ])("rejects %s", (v) => {
    expect(isValidDocIdentifier(v)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidDocIdentifier(undefined)).toBe(false);
    expect(isValidDocIdentifier(123)).toBe(false);
    expect(isValidDocIdentifier({})).toBe(false);
  });
});

describe("asDocIdentifier — decode-boundary narrowing", () => {
  it("passes a valid id through", () => {
    expect(asDocIdentifier("d_1")).toBe("d_1");
  });
  it("collapses a malformed / non-string id to empty", () => {
    expect(asDocIdentifier("../admin")).toBe("");
    expect(asDocIdentifier("a/b")).toBe("");
    expect(asDocIdentifier(undefined)).toBe("");
  });
});

describe("buildDocNavUrl — locally rebuilt safe nav URL (P1-b)", () => {
  it("builds a same-origin relative /d/ path from validated ids", () => {
    expect(buildDocNavUrl("d1", "sp1")).toBe("/d/d1?sp=sp1");
  });

  it("omits sp when spaceId is absent or invalid", () => {
    expect(buildDocNavUrl("d1", "")).toBe("/d/d1");
    expect(buildDocNavUrl("d1", "../x")).toBe("/d/d1");
  });

  it("returns empty (no navigation) for an invalid docId", () => {
    expect(buildDocNavUrl("../admin", "sp1")).toBe("");
    expect(buildDocNavUrl("", "sp1")).toBe("");
  });

  it("never emits a scheme or a wire-controlled absolute URL", () => {
    const url = buildDocNavUrl("d1", "sp1");
    expect(url.startsWith("/d/")).toBe(true);
    expect(url).not.toMatch(/^https?:|^javascript:|^data:/i);
  });
});

describe("permissionState — badge driven only by live ACL, wire claim neutralized (P2-3)", () => {
  it("denied → no_access, unavailable → unavailable", () => {
    expect(permissionState("denied")).toBe("no_access");
    expect(permissionState("unavailable")).toBe("unavailable");
  });

  it("ready (ACL confirmed) → reader", () => {
    expect(permissionState("ready")).toBe("reader");
  });

  it.each(["loading", "error"] as const)(
    "%s → checking (access unconfirmed — never claims view access nor a grant)",
    (status) => {
      expect(permissionState(status)).toBe("checking");
    },
  );
});
