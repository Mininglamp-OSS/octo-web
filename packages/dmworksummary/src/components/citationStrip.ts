import { decodeString } from 'micromark-util-decode-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

interface SourceRange {
    start: number;
    end: number;
}

interface DecodedSourceUnit extends SourceRange {
    value: string;
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const markerPatternSource = String.raw`\[(\d+)\](?!\()|\[P(\d{1,3})\]`;
const trailingEntityWithoutSemicolon = /&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31})$/i;

/** Map each decoded UTF-16 code unit back to its range in the markdown source. */
function mapDecodedSource(rawText: string, decodedText: string): SourceRange[] | null {
    const units: DecodedSourceUnit[] = [];
    let cursor = 0;
    const encodedToken = /\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;

    const append = (value: string, start: number, end: number) => {
        for (let index = 0; index < value.length; index += 1) {
            units.push({ value: value[index], start, end });
        }
    };

    let match: RegExpExecArray | null;
    while ((match = encodedToken.exec(rawText)) !== null) {
        for (let index = cursor; index < match.index; index += 1) {
            append(rawText[index], index, index + 1);
        }

        append(decodeString(match[0]), match.index, match.index + match[0].length);
        cursor = match.index + match[0].length;
    }

    for (let index = cursor; index < rawText.length; index += 1) {
        append(rawText[index], index, index + 1);
    }

    // Continuation prefixes (`> `, list indentation, tabs) can sit inside a
    // text node's source span without appearing in node.value. Align the AST
    // value as a subsequence so those syntax bytes remain untouched.
    const ranges: SourceRange[] = [];
    let unitIndex = 0;
    for (let valueIndex = 0; valueIndex < decodedText.length; valueIndex += 1) {
        while (unitIndex < units.length && units[unitIndex].value !== decodedText[valueIndex]) {
            unitIndex += 1;
        }
        if (unitIndex >= units.length) return null;
        ranges.push({ start: units[unitIndex].start, end: units[unitIndex].end });
        unitIndex += 1;
    }

    return ranges;
}

/**
 * True when `node` is the DESTINATION text of an autolink rather than ordinary prose.
 *
 * In mdast a GFM literal autolink (`https://x/y`), an `<...>` autolink and an email
 * autolink are all `link` nodes whose ONLY child is a text node holding the URL itself.
 * A `visit(tree, 'text')` walk therefore steps straight into the destination, and deleting
 * a `[n]` from it rewrites the link target. On screen that is invisible — the renderer
 * substitutes the same text but the `<a href>` keeps the full URL — but the converted
 * document has no href to fall back on: the corrupted string IS the link, and it is
 * persisted. A working link in the summary becomes a dead one in the document, silently.
 *
 * Deliberately matched on the autolink SHAPE, not on `parent.type === 'link'`: an inline
 * `[label](dest)` link also parents its label text, and stripping markers out of link
 * TEXT is correct — that text is prose the reader sees. Only the destination is off-limits.
 * The three URL forms mirror how remark normalizes each autolink flavour:
 *   `<https://x/y>` / `https://x/y` -> url === value
 *   `<a@b.com>` / `a@b.com`         -> url === 'mailto:' + value
 *   `www.x.com/y`                   -> url === 'http://' + value  (checked via '//' + value)
 */
function isAutolinkDestination(node: unknown, parent: unknown): boolean {
    if (!parent || typeof parent !== 'object') return false;
    const link = parent as { type?: unknown; url?: unknown; children?: unknown };
    if (link.type !== 'link') return false;
    if (!Array.isArray(link.children) || link.children.length !== 1) return false;
    if (link.children[0] !== node) return false;
    const url = link.url;
    const value = (node as { value?: unknown } | null)?.value;
    if (typeof url !== 'string' || typeof value !== 'string') return false;
    return url === value || url === `mailto:${value}` || url.endsWith(`//${value}`);
}

/**
 * Remove citation markers before converting a summary to an online document.
 *
 * Markdown is parsed with the same remark parser and grammar used by the
 * renderer. We inspect only text nodes, so code, inline-link destinations,
 * definitions, and other non-text syntax stay untouched — plus autolink
 * destinations, which ARE text nodes and so need the explicit guard below
 * (see isAutolinkDestination). Ranges are removed from the original source
 * instead of stringifying the AST, preserving whitespace and formatting.
 */
export function stripCitationMarkers(source: string): string {
    if (!source) return source;

    const tree = markdownParser.parse(source);
    const removals: SourceRange[] = [];

    visit(tree, 'text', (node: any, _index, parent: any) => {
        // An autolink's URL is its own text child; editing it rewrites the link target.
        if (isAutolinkDestination(node, parent)) return;
        const start = node.position?.start?.offset;
        const positionEnd = node.position?.end?.offset;
        if (typeof start !== 'number' || typeof positionEnd !== 'number') return;
        if (start < 0 || positionEnd < start || positionEnd > source.length) return;
        if (typeof node.value !== 'string') return;

        // remark-parse@10 reports a terminal character reference's end offset
        // immediately before its semicolon. Include it so decoded/source
        // offsets still line up when a citation marker ends the document.
        let sourceEnd = positionEnd;
        if (
            source[sourceEnd] === ';' &&
            trailingEntityWithoutSemicolon.test(source.slice(start, sourceEnd))
        ) {
            sourceEnd += 1;
        }

        const rawText = source.slice(start, sourceEnd);
        const sourceRanges = mapDecodedSource(rawText, node.value);

        // `[1](url)` is a link node, so its brackets do not appear in this
        // text-node range. Nested link text still follows the renderer exactly.
        const markerPattern = new RegExp(markerPatternSource, 'g');
        let match: RegExpExecArray | null;
        if (!sourceRanges) {
            while ((match = markerPattern.exec(rawText)) !== null) {
                removals.push({
                    start: start + match.index,
                    end: start + match.index + match[0].length,
                });
            }
            return;
        }

        while ((match = markerPattern.exec(node.value)) !== null) {
            const first = sourceRanges[match.index];
            const last = sourceRanges[match.index + match[0].length - 1];
            if (!first || !last) continue;
            removals.push({
                start: start + first.start,
                end: start + last.end,
            });
        }
    });

    return removals
        .sort((left, right) => right.start - left.start)
        .reduce(
            (result, range) => result.slice(0, range.start) + result.slice(range.end),
            source,
        );
}
