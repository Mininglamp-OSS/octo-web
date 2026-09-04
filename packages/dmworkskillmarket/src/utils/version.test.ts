import { describe, expect, it } from "vitest";
import { isStoredVersionLabel, versionErrorKey } from "./version";

const FORMAT = "skillMarket.plugin.versionFormatInvalid";
const ORDER = "skillMarket.plugin.versionMustNotDecrease";

/**
 * The labels below are not invented: they are the shapes that reached production
 * before the backend tightened the version format to `x.y.z`, which is why the
 * server carries a grandfathering exemption at all
 * (internal/service/plugin/service.go WriteRequest.grandfatheredVersion).
 */
const LEGACY_LABELS = ["1.0", "v1.2.3", "2.0.0-beta.1", "v999", "1.0.0lll"];

describe("versionErrorKey", () => {
  describe("without a stored label (review-submit surfaces)", () => {
    it("refuses every legacy label — SubmitReview has no exemption", () => {
      for (const label of LEGACY_LABELS) {
        expect(versionErrorKey(label, label)).toBe(FORMAT);
      }
    });
  });

  describe("with the stored label (save surfaces)", () => {
    it("accepts each legacy label that is byte-equal to the stored one", () => {
      for (const label of LEGACY_LABELS) {
        expect(versionErrorKey(label, label, label)).toBeNull();
      }
    });

    it("accepts the stored label around surrounding space, like the server's TrimSpace", () => {
      expect(versionErrorKey("1.0", "  1.0  ", "1.0")).toBeNull();
      expect(versionErrorKey("1.0", "1.0", "  1.0  ")).toBeNull();
    });

    it("still refuses a DIFFERENT malformed label — the server would 400 it", () => {
      // The exemption is keyed on the stored value, not on "malformed is fine".
      expect(versionErrorKey("1.0", "1.1", "1.0")).toBe(FORMAT);
      expect(versionErrorKey("v1.2.3", "v1.2.4", "v1.2.3")).toBe(FORMAT);
      expect(versionErrorKey("2.0.0-beta.1", "2.0.0-beta.2", "2.0.0-beta.1")).toBe(FORMAT);
    });

    it("does not let the stored label be nominated by the form", () => {
      // A stored label of `1.2.0` cannot grandfather the typed `9.9`; only a
      // value read off the row can, which is why `stored` is a separate argument.
      expect(versionErrorKey("1.2.0", "9.9", "1.2.0")).toBe(FORMAT);
    });

    it("lets a legacy label be repaired to any well-formed one", () => {
      // The server's forward-only check treats an unparseable current label as
      // blocking nothing, so a row stranded on `v999` can be corrected — even
      // downwards-looking, since there is no order to go down from.
      for (const label of LEGACY_LABELS) {
        expect(versionErrorKey(label, "2.3.4", label)).toBeNull();
        expect(versionErrorKey(label, "0.0.1", label)).toBeNull();
      }
    });
  });

  describe("ordering between two well-formed labels", () => {
    it("refuses a downgrade whether or not a stored label is passed", () => {
      expect(versionErrorKey("2.0.0", "1.5.0")).toBe(ORDER);
      expect(versionErrorKey("2.0.0", "1.5.0", "2.0.0")).toBe(ORDER);
    });

    it("allows staying put and moving up, comparing parts numerically", () => {
      expect(versionErrorKey("1.9.0", "1.10.0", "1.9.0")).toBeNull();
      expect(versionErrorKey("1.2.0", "1.2.0", "1.2.0")).toBeNull();
      expect(versionErrorKey("1.10.0", "1.9.0", "1.10.0")).toBe(ORDER);
    });

    it("reports a malformed next as a FORMAT problem, not an ordering one", () => {
      // Matches the server, which runs the format gate on the submitted label
      // before it can be compared (applyStoredVersionRules gates its ordering
      // check on validVersion for exactly this reason).
      expect(versionErrorKey("2.0.0", "1.5", "2.0.0")).toBe(FORMAT);
    });
  });

  it("leaves an empty field to the caller's required-field check", () => {
    expect(versionErrorKey("1.0", "", "1.0")).toBeNull();
    expect(versionErrorKey("1.0", "   ", "1.0")).toBeNull();
  });
});

describe("isStoredVersionLabel", () => {
  it("is byte equality modulo surrounding space", () => {
    expect(isStoredVersionLabel("1.0", "1.0")).toBe(true);
    expect(isStoredVersionLabel("1.0", " 1.0 ")).toBe(true);
    expect(isStoredVersionLabel("1.0", "1.0.0")).toBe(false);
    expect(isStoredVersionLabel("1.0", "1. 0")).toBe(false);
  });

  it("treats an absent stored label as no exemption, mirroring a NULL column", () => {
    expect(isStoredVersionLabel(undefined, "1.0")).toBe(false);
  });
});
