import { describe, expect, it } from "vitest";
import {
  decideComposerKeyboard,
  type ComposerKeyboardInput,
} from "../keyboardPolicy";

const input = (
  overrides: Partial<ComposerKeyboardInput> = {},
): ComposerKeyboardInput => ({
  key: "Enter",
  shiftKey: false,
  altKey: false,
  isComposing: false,
  slashMenuVisible: false,
  slashItemCount: 0,
  slashActiveIndex: 0,
  mentionActive: false,
  emojiActive: false,
  ...overrides,
});

describe("composer keyboard policy", () => {
  it.each([
    { isComposing: true },
    { keyCode: 229 },
  ])("passes IME confirmation Enter through: %o", (overrides) => {
    expect(decideComposerKeyboard(input(overrides))).toEqual({ kind: "pass" });
  });

  it("keeps Shift+Enter available for the editor hard-break keymap", () => {
    expect(
      decideComposerKeyboard(input({ shiftKey: true })),
    ).toEqual({ kind: "pass" });
  });

  it("lets active mention and emoji suggestions own plain Enter", () => {
    expect(
      decideComposerKeyboard(input({ mentionActive: true })),
    ).toEqual({ kind: "pass" });
    expect(
      decideComposerKeyboard(input({ emojiActive: true })),
    ).toEqual({ kind: "pass" });
  });

  it("leaves Alt+Enter to the editor", () => {
    expect(decideComposerKeyboard(input())).toEqual({
      kind: "send",
      closeSlash: false,
    });
    expect(decideComposerKeyboard(input({ altKey: true }))).toEqual({ kind: "pass" });
  });

  it("closes and navigates the slash menu with wrapping indices", () => {
    expect(
      decideComposerKeyboard(
        input({ key: "Escape", slashMenuVisible: true, slashItemCount: 3 }),
      ),
    ).toEqual({ kind: "close-slash" });
    expect(
      decideComposerKeyboard(
        input({
          key: "ArrowDown",
          slashMenuVisible: true,
          slashItemCount: 3,
          slashActiveIndex: 2,
        }),
      ),
    ).toEqual({ kind: "move-slash", index: 0 });
    expect(
      decideComposerKeyboard(
        input({
          key: "ArrowUp",
          slashMenuVisible: true,
          slashItemCount: 3,
          slashActiveIndex: 0,
        }),
      ),
    ).toEqual({ kind: "move-slash", index: 2 });
  });

  it("normalizes a stale slash index before selection", () => {
    expect(
      decideComposerKeyboard(
        input({
          slashMenuVisible: true,
          slashItemCount: 2,
          slashActiveIndex: 5,
        }),
      ),
    ).toEqual({ kind: "select-slash", index: 1 });
  });

  it("sends and closes the slash menu when the filter has no results", () => {
    expect(
      decideComposerKeyboard(
        input({ slashMenuVisible: true, slashItemCount: 0 }),
      ),
    ).toEqual({ kind: "send", closeSlash: true });
  });

  it("keeps slash menu priority over Alt+Enter", () => {
    expect(
      decideComposerKeyboard(
        input({
          slashMenuVisible: true,
          slashItemCount: 1,
          altKey: true,
        }),
      ),
    ).toEqual({ kind: "select-slash", index: 0 });
  });
});
