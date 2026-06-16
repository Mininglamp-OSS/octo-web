import { isSafeUrl } from "./security";

export type SafeUrlTextSegment =
  | { type: "text"; content: string }
  | { type: "link"; text: string; href: string };

const safeUrlPattern = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const trailingUrlPunctuation = new Set([
  ".",
  ",",
  "!",
  "?",
  ";",
  ":",
  ")",
  "]",
  "}",
  "。",
  "，",
  "！",
  "？",
  "；",
  "：",
  "）",
  "】",
  "』",
]);

function splitTrailingPunctuation(value: string) {
  let end = value.length;
  while (end > 0 && trailingUrlPunctuation.has(value[end - 1])) {
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
    const { linkText, trailingText } = splitTrailingPunctuation(rawUrl);
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
