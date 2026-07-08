import { describe, it, expect } from "vitest"
import {
    DEFAULT_STICKER_UPLOAD_LIMITS,
    parseStickerUploadLimits,
    stickerUploadLimitsEqual,
} from "../StickerUploadConfig"

describe("parseStickerUploadLimits", () => {
    it("falls back to historical hardcoded defaults when the field is absent", () => {
        expect(parseStickerUploadLimits(undefined)).toEqual(DEFAULT_STICKER_UPLOAD_LIMITS)
        expect(parseStickerUploadLimits(null)).toEqual(DEFAULT_STICKER_UPLOAD_LIMITS)
        expect(parseStickerUploadLimits("not an object")).toEqual(DEFAULT_STICKER_UPLOAD_LIMITS)
    })

    it("parses a well-formed sticker_upload_limits object", () => {
        expect(
            parseStickerUploadLimits({
                max_size_kb: 3072,
                max_dimension: 900,
                allowed_formats: [".png", ".gif"],
            })
        ).toEqual({ maxSizeKB: 3072, maxDimension: 900, allowedFormats: [".png", ".gif"] })
    })

    it("falls back field-by-field, not all-or-nothing", () => {
        // max_size_kb malformed → only that field falls back; the other two still parse.
        expect(
            parseStickerUploadLimits({
                max_size_kb: "not a number",
                max_dimension: 900,
                allowed_formats: [".png"],
            })
        ).toEqual({ maxSizeKB: DEFAULT_STICKER_UPLOAD_LIMITS.maxSizeKB, maxDimension: 900, allowedFormats: [".png"] })
    })

    it.each([0, -1, NaN, "not a number", undefined, null])(
        "rejects non-positive/non-numeric max_size_kb %s and falls back",
        (value) => {
            expect(parseStickerUploadLimits({ max_size_kb: value }).maxSizeKB).toBe(
                DEFAULT_STICKER_UPLOAD_LIMITS.maxSizeKB
            )
        }
    )

    // PR #555 review: a fraction in (0,1) used to pass the pre-floor `n > 0` check and then
    // floor to 0 — falling through as a "valid" 0 instead of the fallback, which would brick
    // every upload (file.size > 0 is always true). Guard against that regressing.
    it.each([0.5, 0.9, 0.999, "0.5"])(
        "does not let a fractional max_size_kb %s floor to 0 and slip past the fallback",
        (value) => {
            expect(parseStickerUploadLimits({ max_size_kb: value }).maxSizeKB).toBe(
                DEFAULT_STICKER_UPLOAD_LIMITS.maxSizeKB
            )
        }
    )

    it("accepts a numeric string for max_dimension (defensive against string-typed JSON)", () => {
        expect(parseStickerUploadLimits({ max_dimension: "900" }).maxDimension).toBe(900)
    })

    it("truncates a non-integer max_dimension", () => {
        expect(parseStickerUploadLimits({ max_dimension: 900.9 }).maxDimension).toBe(900)
    })

    it("falls back when allowed_formats is missing, not an array, or empty", () => {
        expect(parseStickerUploadLimits({ allowed_formats: undefined }).allowedFormats).toEqual(
            DEFAULT_STICKER_UPLOAD_LIMITS.allowedFormats
        )
        expect(parseStickerUploadLimits({ allowed_formats: ".gif" }).allowedFormats).toEqual(
            DEFAULT_STICKER_UPLOAD_LIMITS.allowedFormats
        )
        expect(parseStickerUploadLimits({ allowed_formats: [] }).allowedFormats).toEqual(
            DEFAULT_STICKER_UPLOAD_LIMITS.allowedFormats
        )
    })

    it("drops non-string / empty-string entries from allowed_formats but keeps the rest", () => {
        expect(
            parseStickerUploadLimits({ allowed_formats: [".gif", 123, "", null, ".png"] }).allowedFormats
        ).toEqual([".gif", ".png"])
    })

    // PR #555 review: getStickerFileExtension always returns a lowercase, dot-prefixed
    // extension, but allowed_formats was passed through verbatim — a dotless or uppercase
    // server payload would fail-closed and reject every legitimate upload. Normalize on
    // the way in so the two sides of the comparison stay in the same canonical form
    // regardless of exactly how the server formats each entry.
    it("normalizes allowed_formats entries to lowercase-with-leading-dot", () => {
        expect(
            parseStickerUploadLimits({ allowed_formats: ["PNG", "gif", ".JPG"] }).allowedFormats
        ).toEqual([".png", ".gif", ".jpg"])
    })
})

describe("stickerUploadLimitsEqual", () => {
    const base = { maxSizeKB: 1024, maxDimension: 512, allowedFormats: [".gif", ".png"] }

    it("is true for two structurally identical values", () => {
        expect(stickerUploadLimitsEqual(base, { ...base, allowedFormats: [...base.allowedFormats] })).toBe(true)
    })

    it("is false when maxSizeKB differs", () => {
        expect(stickerUploadLimitsEqual(base, { ...base, maxSizeKB: 2048 })).toBe(false)
    })

    it("is false when maxDimension differs", () => {
        expect(stickerUploadLimitsEqual(base, { ...base, maxDimension: 256 })).toBe(false)
    })

    it("is false when allowedFormats differs in length", () => {
        expect(stickerUploadLimitsEqual(base, { ...base, allowedFormats: [".gif"] })).toBe(false)
    })

    it("is false when allowedFormats differs in order or content", () => {
        expect(stickerUploadLimitsEqual(base, { ...base, allowedFormats: [".png", ".gif"] })).toBe(false)
    })
})
