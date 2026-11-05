import { mergeNameMatchRanges } from "../../Utils/nameMatchRanges";
import type {
  NameMatchRange,
  NameSearchItem,
} from "../../Service/NameSearchTypes";

export interface NameSegment {
  text: string;
  matched: boolean;
}
export interface NameDisplayLine {
  field: "original" | "remark";
  text: string;
  segments: NameSegment[];
}

/** Produces plain text segments; the renderer owns styling and escaping. */
export function splitNameMatches(
  text: string,
  ranges: readonly NameMatchRange[]
): NameSegment[] {
  const chars = Array.from(text);
  const result: NameSegment[] = [];
  let offset = 0;
  for (const range of mergeNameMatchRanges(ranges, chars.length)) {
    if (offset < range.start)
      result.push({
        text: chars.slice(offset, range.start).join(""),
        matched: false,
      });
    result.push({
      text: chars.slice(range.start, range.end).join(""),
      matched: true,
    });
    offset = range.end;
  }
  if (offset < chars.length)
    result.push({ text: chars.slice(offset).join(""), matched: false });
  return result;
}

export function nameDisplayLines(item: NameSearchItem): NameDisplayLine[] {
  const line = (
    field: "original" | "remark",
    text: string,
    ranges: NameMatchRange[]
  ): NameDisplayLine => ({
    field,
    text,
    segments: splitNameMatches(text, ranges),
  });
  if (!item.remarkName.trim())
    return [line("original", item.originalName, item.matches.original)];
  if (item.originalName === item.remarkName)
    return [
      line("remark", item.remarkName, [
        ...item.matches.original,
        ...item.matches.remark,
      ]),
    ];
  const result = [line("remark", item.remarkName, item.matches.remark)];
  if (item.originalName)
    result.push(line("original", item.originalName, item.matches.original));
  return result;
}
