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

describe("buildDocNavUrl — locally rebuilt safe nav URL (P1-b, Phase-1 no sp)", () => {
  it("builds a same-origin relative /d/ path from the validated docId (no sp — design §5.3)", () => {
    expect(buildDocNavUrl("d1")).toBe("/d/d1");
    expect(buildDocNavUrl("DOC-9_x")).toBe("/d/DOC-9_x");
  });

  it("never emits a `?sp=` query (Phase-1 removed the doc Space from ordinary links)", () => {
    expect(buildDocNavUrl("d1")).not.toContain("sp=");
    expect(buildDocNavUrl("d1")).not.toContain("?");
  });

  it("returns empty (no navigation) for an invalid docId", () => {
    expect(buildDocNavUrl("../admin")).toBe("");
    expect(buildDocNavUrl("")).toBe("");
  });

  it("never emits a scheme or a wire-controlled absolute URL", () => {
    const url = buildDocNavUrl("d1");
    expect(url.startsWith("/d/")).toBe(true);
    expect(url).not.toMatch(/^https?:|^javascript:|^data:/i);
  });
});

describe("permissionState — only live ACL controls the effective badge", () => {
  it("denied → no_access, unavailable → unavailable", () => {
    expect(permissionState("denied")).toBe("no_access");
    expect(permissionState("unavailable")).toBe("unavailable");
  });

  it("ready (ACL confirmed) → reader", () => {
    expect(permissionState("ready")).toBe("reader");
  });

  it("loading → checking (access unconfirmed — never claims view access nor a grant)", () => {
    expect(permissionState("loading")).toBe("checking");
  });

  it("error → unavailable (document module may not exist in the open-source build)", () => {
    expect(permissionState("error")).toBe("unavailable");
  });
});
