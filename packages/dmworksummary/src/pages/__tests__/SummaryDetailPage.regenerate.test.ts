import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../SummaryDetailPage.tsx"), "utf8");
const styles = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

describe("SummaryDetailPage regenerate dialog", () => {
    it("opens in refine mode and preserves the full prompt as its separate draft", () => {
        expect(source).toContain('regenerateMode: "refine"');
        expect(source).toContain('regenerateTopic: detail?.title || ""');
        expect(source).toContain('refineFeedback: ""');
    });

    it("renders both mode choices with their impact descriptions", () => {
        expect(source).toContain('summary.detail.refineModeTitle');
        expect(source).toContain('summary.detail.refineModeDesc');
        expect(source).toContain('summary.detail.fullRegenerateModeTitle');
        expect(source).toContain('summary.detail.fullRegenerateModeDesc');
        expect(source).toContain('type="radio"');
        expect(source).toContain('name="summary-regenerate-mode"');
    });

    it("uses mode-specific input fields, placeholders, voice input, and the shared max length", () => {
        expect(source).toContain('summary.detail.refineFeedbackPlaceholder');
        expect(source).toContain('summary.detail.regenerateTopicPlaceholder');
        expect(source).toContain('<VoiceInputButton');
        expect(source).toContain('onTranscribed={this.handleRegenerateInputVoice}');
        expect(source).toContain('maxLength={SUMMARY_INPUT_MAX_LENGTH}');
        expect(source).toContain('/{SUMMARY_INPUT_MAX_LENGTH}');
        expect(source).not.toContain('maxLength={1000}');
    });

    it("reserves space for the textarea voice control and character count", () => {
        expect(styles).toMatch(/\.summary-regenerate-textarea\s*\{[^}]*padding:\s*6px 40px 28px 12px;/s);
    });
});
