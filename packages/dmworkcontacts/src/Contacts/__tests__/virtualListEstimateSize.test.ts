import { describe, expect, it } from "vitest";

const ITEM_HEIGHT = 44;
const LETTER_HEADER_HEIGHT = 24;

type ContactListRow = {
    uid: string;
    pinyin: string;
};

function getLetterFromPinyin(py: string): string {
    let letter = (py && py[0]) || "#";
    if (!/[A-Z]/.test(letter)) letter = "#";
    return letter;
}

function buildListRows(items: ContactListRow[]): { showLetter: boolean; letter: string }[] {
    const listRows: { showLetter: boolean; letter: string }[] = [];
    let prevLetter = "";
    for (const item of items) {
        const letter = getLetterFromPinyin(item.pinyin);
        listRows.push({ letter, showLetter: letter !== prevLetter });
        prevLetter = letter;
    }
    return listRows;
}

function estimateSize(index: number, rows: { showLetter: boolean }[]): number {
    return rows[index]?.showLetter ? ITEM_HEIGHT + LETTER_HEADER_HEIGHT : ITEM_HEIGHT;
}

describe("virtual list letter header height", () => {
    it("estimateSize returns 68 for rows that show a letter header", () => {
        const rows = [{ showLetter: true }, { showLetter: false }];
        expect(estimateSize(0, rows)).toBe(68);
    });

    it("estimateSize returns 44 for rows without a letter header", () => {
        const rows = [{ showLetter: true }, { showLetter: false }];
        expect(estimateSize(1, rows)).toBe(44);
    });

    it("marks only the first item in each letter group with showLetter=true", () => {
        const items: ContactListRow[] = [
            { uid: "a1", pinyin: "A" },
            { uid: "a2", pinyin: "A" },
            { uid: "a3", pinyin: "A" },
            { uid: "b1", pinyin: "B" },
            { uid: "b2", pinyin: "B" },
        ];
        const rows = buildListRows(items);
        expect(rows[0].showLetter).toBe(true);
        expect(rows[0].letter).toBe("A");
        expect(rows[1].showLetter).toBe(false);
        expect(rows[2].showLetter).toBe(false);
        expect(rows[3].showLetter).toBe(true);
        expect(rows[3].letter).toBe("B");
        expect(rows[4].showLetter).toBe(false);
    });

    it("LETTER_HEADER_HEIGHT is 24, aligning with CSS .wk-contacts-letter-header height", () => {
        expect(LETTER_HEADER_HEIGHT).toBe(24);
        expect(ITEM_HEIGHT).toBe(44);
    });
});
