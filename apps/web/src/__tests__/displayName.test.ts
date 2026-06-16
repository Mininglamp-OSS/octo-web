import { describe, it, expect } from "vitest";
import { displayName, isRealnameVerified } from "../../../../packages/dmworkbase/src/Utils/displayName";

describe("displayName (GH dmwork-web#1121)", () => {
    it("returns empty string for null/undefined user", () => {
        expect(displayName(undefined)).toBe("");
        expect(displayName(null)).toBe("");
    });

    it("falls back to name when no remark and not verified", () => {
        expect(displayName({ name: "Alice" })).toBe("Alice");
        expect(displayName({ name: "Alice", realname_verified: false })).toBe("Alice");
        expect(displayName({ name: "Alice", realname_verified: 0 })).toBe("Alice");
    });

    it("returns remark when set and not verified", () => {
        expect(displayName({ name: "Alice", remark: "Ally" })).toBe("Ally");
        // verified real_name 优先于 remark
        expect(
            displayName({
                name: "alice",
                remark: "A-remark",
                real_name: "Alice Real",
                realname_verified: true,
            })
        ).toBe("Alice Real");
    });

    it("verified real_name beats remark and nickname (highest priority)", () => {
        expect(
            displayName({
                name: "alice",
                remark: "A-remark",
                real_name: "Alice Real",
                realname_verified: 1,
            })
        ).toBe("Alice Real");
        // 未实名时 remark 仍优先于 nickname
        expect(
            displayName({
                name: "alice",
                remark: "A-remark",
                real_name: "Alice Real",
                realname_verified: false,
            })
        ).toBe("A-remark");
    });

    it("returns real_name when verified (true or 1) and real_name non-empty", () => {
        expect(
            displayName({ name: "alice", real_name: "Alice Real", realname_verified: true })
        ).toBe("Alice Real");
        expect(
            displayName({ name: "alice", real_name: "Alice Real", realname_verified: 1 })
        ).toBe("Alice Real");
    });

    it("does NOT use real_name when not verified or empty", () => {
        expect(
            displayName({ name: "alice", real_name: "Alice Real", realname_verified: false })
        ).toBe("alice");
        expect(
            displayName({ name: "alice", real_name: "", realname_verified: true })
        ).toBe("alice");
        expect(
            displayName({ name: "alice", realname_verified: true })
        ).toBe("alice");
    });

    it("handles empty remark string as unset", () => {
        expect(
            displayName({ name: "alice", remark: "", real_name: "Alice Real", realname_verified: true })
        ).toBe("Alice Real");
    });
});

describe("isRealnameVerified", () => {
    it("returns false for null/undefined", () => {
        expect(isRealnameVerified(undefined)).toBe(false);
        expect(isRealnameVerified(null)).toBe(false);
    });

    it("accepts boolean true and number 1", () => {
        expect(isRealnameVerified({ realname_verified: true })).toBe(true);
        expect(isRealnameVerified({ realname_verified: 1 })).toBe(true);
    });

    it("rejects boolean false, 0, and missing", () => {
        expect(isRealnameVerified({ realname_verified: false })).toBe(false);
        expect(isRealnameVerified({ realname_verified: 0 })).toBe(false);
        expect(isRealnameVerified({})).toBe(false);
    });
});
