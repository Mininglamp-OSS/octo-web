import { describe, expect, it } from "vitest";
import {
  decodeSafeFleetSegment,
  isFleetIssuePathShape,
} from "../fleetTrust";

describe("decodeSafeFleetSegment", () => {
  it("decodes unreserved characters", () => {
    expect(decodeSafeFleetSegment("team-a")).toBe("team-a");
    expect(decodeSafeFleetSegment("OPS-9")).toBe("OPS-9");
    expect(decodeSafeFleetSegment("a.b_c~1")).toBe("a.b_c~1");
    // encoded unreserved forms decode and pass
    expect(decodeSafeFleetSegment("team%2Da")).toBe("team-a");
  });

  it("rejects encoded separators and control characters", () => {
    expect(decodeSafeFleetSegment("a%2F..%2Fb")).toBeNull();
    expect(decodeSafeFleetSegment("..%2F..%2Fadmin")).toBeNull();
    expect(decodeSafeFleetSegment("team%5C..%5Cadmin")).toBeNull();
    expect(decodeSafeFleetSegment("c%0D%0Ad")).toBeNull();
    expect(decodeSafeFleetSegment("c%0Ad")).toBeNull();
  });

  it("rejects malformed percent-encoding and unsafe decoded chars", () => {
    expect(decodeSafeFleetSegment("a%")).toBeNull();
    expect(decodeSafeFleetSegment("a%ZZ")).toBeNull();
    expect(decodeSafeFleetSegment("a b")).toBeNull();
    expect(decodeSafeFleetSegment("a/b")).toBeNull();
    expect(decodeSafeFleetSegment("../secret")).toBeNull();
  });
});

describe("isFleetIssuePathShape", () => {
  it("accepts a canonical fleet path", () => {
    expect(isFleetIssuePathShape("/fleet/team-a/issues/OPS-9")).toBe(true);
  });

  it("rejects wrong shapes", () => {
    expect(isFleetIssuePathShape("/docs/1")).toBe(false);
    expect(isFleetIssuePathShape("/fleet/a/issues")).toBe(false);
    expect(isFleetIssuePathShape("/fleet/a")).toBe(false);
    expect(isFleetIssuePathShape("fleet/a/issues/OPS-9")).toBe(true); // no leading slash is fine
  });

  it("rejects encoded-separator segments even when the shape gate would pass", () => {
    expect(isFleetIssuePathShape("/fleet/a%2F..%2Fb/issues/c%0D%0Ad")).toBe(false);
    expect(isFleetIssuePathShape("/fleet/..%2F..%2Fadmin/issues/..%2Fsecret")).toBe(false);
    expect(isFleetIssuePathShape("/fleet/team%5C..%5Cadmin/issues/x")).toBe(false);
  });

  it("rejects trailing-slash-only oddities consistently", () => {
    expect(isFleetIssuePathShape("/fleet/a/issues/OPS-9/")).toBe(true); // trailing slash normalized
  });
});
