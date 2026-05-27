import { t } from "@octo/base";

export function splitSummaryText(markdown: string, maxLen = 4500): string[] {
    if (!markdown || !markdown.trim()) return [];

    // Split by ## headings
    let sections = splitByHeadings(markdown);

    // If only one section and it's too long, split by double newlines
    if (sections.length === 1 && sections[0].length > maxLen) {
        sections = sections[0].split(/\n\n+/);
    }

    // Merge small adjacent sections
    const merged = mergeSections(sections, maxLen);

    // Hard cut any remaining oversized chunks
    const chunks: string[] = [];
    for (const section of merged) {
        if (section.length <= maxLen) {
            chunks.push(section);
        } else {
            chunks.push(...hardCut(section, maxLen));
        }
    }

    if (chunks.length === 0) return [];

    // Append signature to last chunk
    const last = chunks[chunks.length - 1];
    const signature = `\n\n${t("summary.splitMessage.signature")}`;
    if (last.length + signature.length <= maxLen) {
        chunks[chunks.length - 1] = last + signature;
    } else {
        chunks.push(signature.trimStart());
    }

    return chunks;
}

function splitByHeadings(markdown: string): string[] {
    const parts = markdown.split(/(?=^## )/m);
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function mergeSections(sections: string[], maxLen: number): string[] {
    const result: string[] = [];
    let buffer = "";

    for (const section of sections) {
        const candidate = buffer ? buffer + "\n\n" + section : section;
        if (candidate.length <= maxLen) {
            buffer = candidate;
        } else {
            if (buffer) result.push(buffer);
            buffer = section;
        }
    }
    if (buffer) result.push(buffer);
    return result;
}

function hardCut(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    const chars = [...text];
    let buffer = '';

    for (const char of chars) {
        if ((buffer + char).length > maxLen) {
            if (buffer) chunks.push(buffer);
            buffer = char;
        } else {
            buffer += char;
        }
    }
    if (buffer) chunks.push(buffer);
    return chunks;
}
