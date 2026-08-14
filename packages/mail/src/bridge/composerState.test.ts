import { describe, expect, it } from "vitest";
import { hasComposerChanges, type ComposerFieldState } from "./composerState";

const initial: ComposerFieldState = {
  to: "owner@example.test",
  cc: "",
  bcc: "",
  subject: "Existing subject",
  body: "Existing body",
  attachments: "report.pdf\u0000application/pdf\u0000100\u0000136",
};

describe("composer change detection", () => {
  it("does not mark an untouched existing Draft as changed", () => {
    expect(hasComposerChanges({ ...initial }, initial)).toBe(false);
  });

  it("detects a subject-only Draft edit", () => {
    expect(
      hasComposerChanges({ ...initial, subject: "Changed subject" }, initial)
    ).toBe(true);
  });
});
