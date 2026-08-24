export interface ComposerKeyboardInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  slashMenuVisible: boolean;
  slashItemCount: number;
  slashActiveIndex: number;
  mentionActive: boolean;
  emojiActive: boolean;
}

export type ComposerKeyboardDecision =
  | { kind: "pass" }
  | { kind: "close-slash" }
  | { kind: "move-slash"; index: number }
  | { kind: "select-slash"; index: number }
  | { kind: "send"; closeSlash: boolean }
  ;

function normalizeIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/** Pure precedence policy for composer keyboard commands. */
export function decideComposerKeyboard(
  input: ComposerKeyboardInput,
): ComposerKeyboardDecision {
  if (input.isComposing || input.keyCode === 229) return { kind: "pass" };

  const slashItemCount = Math.max(0, Math.floor(input.slashItemCount));
  const slashActiveIndex = normalizeIndex(
    input.slashActiveIndex,
    slashItemCount,
  );
  if (input.slashMenuVisible) {
    if (input.key === "Escape") return { kind: "close-slash" };
    if (input.key === "ArrowDown") {
      return {
        kind: "move-slash",
        index: normalizeIndex(slashActiveIndex + 1, slashItemCount),
      };
    }
    if (input.key === "ArrowUp") {
      return {
        kind: "move-slash",
        index: normalizeIndex(slashActiveIndex - 1, slashItemCount),
      };
    }
    if (input.key === "Enter" && !input.shiftKey) {
      return slashItemCount > 0
        ? { kind: "select-slash", index: slashActiveIndex }
        : { kind: "send", closeSlash: true };
    }
    return { kind: "pass" };
  }

  if (input.key === "Enter" && input.altKey) return { kind: "pass" };

  if (input.key === "Enter" && !input.shiftKey) {
    if (input.mentionActive || input.emojiActive) return { kind: "pass" };
    return { kind: "send", closeSlash: false };
  }

  return { kind: "pass" };
}
