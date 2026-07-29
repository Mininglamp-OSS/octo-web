import { describe, expect, it } from "vitest";
import { applyRegenerateVoiceInput } from "../regenerateInput";

describe("applyRegenerateVoiceInput", () => {
    it("replaces the entire instruction when voice mode is all", () => {
        expect(applyRegenerateVoiceInput("old", "new instruction", "all", undefined, 2000))
            .toBe("new instruction");
    });

    it("replaces the saved selection without changing surrounding text", () => {
        expect(applyRegenerateVoiceInput("before old after", "new", "selection", { from: 7, to: 10 }, 2000))
            .toBe("before new after");
    });

    it("inserts at the saved cursor and enforces the shared max length", () => {
        const current = "a".repeat(1999);
        expect(applyRegenerateVoiceInput(current, "voice", "insert", { from: 1999, to: 1999 }, 2000))
            .toBe(`${current}v`);
    });
});
