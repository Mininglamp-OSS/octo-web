import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";

export function applyRegenerateVoiceInput(
    current: string,
    text: string,
    mode: ReplaceMode,
    savedRange: SelectionRange | undefined,
    maxLength: number,
    countRunes = false,
): string {
    const length = (value: string) => countRunes ? Array.from(value).length : value.length;
    const truncate = (value: string, limit: number) => countRunes ? Array.from(value).slice(0, limit).join("") : value.slice(0, limit);
    if (mode === "all") return truncate(text, maxLength);

    const start = mode === "selection" && savedRange
        ? savedRange.from
        : savedRange?.from ?? current.length;
    const end = mode === "selection" && savedRange ? savedRange.to : start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const budget = Math.max(0, maxLength - length(before) - length(after));
    return before + truncate(text, budget) + after;
}
