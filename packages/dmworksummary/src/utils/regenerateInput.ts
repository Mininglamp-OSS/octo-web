import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";

export function applyRegenerateVoiceInput(
    current: string,
    text: string,
    mode: ReplaceMode,
    savedRange: SelectionRange | undefined,
    maxLength: number,
): string {
    if (mode === "all") return text.slice(0, maxLength);

    const start = mode === "selection" && savedRange
        ? savedRange.from
        : savedRange?.from ?? current.length;
    const end = mode === "selection" && savedRange ? savedRange.to : start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const budget = Math.max(0, maxLength - before.length - after.length);
    return before + text.slice(0, budget) + after;
}
