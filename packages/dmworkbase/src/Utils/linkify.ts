import { isSafeUrl } from "./security";

export type SafeUrlTextSegment =
  | { type: "text"; content: string }
  | { type: "link"; text: string; href: string };

// Bare URLs have no delimiter separating a path from adjacent Chinese prose.
// Treat Han text and Chinese sentence punctuation as boundaries. Chinese URL
// contents can be expressed unambiguously with percent encoding or explicit
// Markdown links; those destinations do not pass through this heuristic.
const safeUrlPattern =
  /(?:https?:\/\/|www\.)[^\s<>"'\p{Script=Han}，。！？；：、…“”‘’]+/giu;
const trailingUrlPunctuation = new Set([
  ".",
  ",",
  "!",
  "?",
  ";",
  ":",
  "。",
  "，",
  "！",
  "？",
  "；",
  "：",
]);
const closingUrlBrackets = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["】", "【"],
  ["』", "『"],
]);
const openingUrlBrackets = new Set(closingUrlBrackets.values());

/**
 * Split prose punctuation from an automatically detected URL, preserving the
 * original text. Explicit link destinations must not use this heuristic.
 * Match brackets left to right so a balanced suffix survives even when an
 * earlier path segment contains an unmatched closing bracket.
 */
export function splitTrailingUrlPunctuation(value: string) {
  const openCounts = new Map<string, number>();
  const unmatchedClosings = new Set<number>();
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (openingUrlBrackets.has(char)) {
      openCounts.set(char, (openCounts.get(char) ?? 0) + 1);
    } else {
      const opening = closingUrlBrackets.get(char);
      if (!opening) continue;
      const count = openCounts.get(opening) ?? 0;
      if (count > 0) openCounts.set(opening, count - 1);
      else unmatchedClosings.add(i);
    }
  }

  let end = value.length;
  while (
    end > 0 &&
    (trailingUrlPunctuation.has(value[end - 1]) ||
      unmatchedClosings.has(end - 1))
  ) {
    end -= 1;
  }
  return {
    linkText: value.slice(0, end),
    trailingText: value.slice(end),
  };
}

function toSafeHref(linkText: string) {
  const href = linkText.toLowerCase().startsWith("www.")
    ? `https://${linkText}`
    : linkText;
  return isSafeUrl(href) ? href : "";
}

export function linkifySafeUrls(text: string): SafeUrlTextSegment[] {
  const segments: SafeUrlTextSegment[] = [];
  let lastIndex = 0;
  safeUrlPattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = safeUrlPattern.exec(text)) !== null) {
    const rawUrl = match[0];
    const index = match.index;
    const { linkText, trailingText } = splitTrailingUrlPunctuation(rawUrl);
    const href = toSafeHref(linkText);

    if (!href) continue;

    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }
    segments.push({ type: "link", text: linkText, href });
    if (trailingText) {
      segments.push({ type: "text", content: trailingText });
    }
    lastIndex = index + rawUrl.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}
