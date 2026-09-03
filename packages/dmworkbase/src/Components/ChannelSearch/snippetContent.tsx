import React, { useMemo } from "react";
import WKApp from "../../App";

type HighlightRange = {
  start: number;
  end: number;
};

/**
 * Decode the HTML entities emitted by the server-side highlight escape
 * (`escapeHighlightFragment` in octo-server, applied only to
 * `FileHit.NameHighlight` / `FileHit.ContentSnippet`) into their literal
 * characters. Pure string transform — no DOM parsing, no template evaluation —
 * so a decoded segment is only ever used as a React text node downstream
 * (never as HTML).
 *
 * The set is closed and follows Apache Lucene's `SimpleHTMLEncoder`, which is
 * what `encoder=html` resolves to server-side:
 *   `"` → `&quot;`, `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`,
 *   `'` → `&#x27;`, `/` → `&#x2F;`.
 * The literal `<mark>` / `</mark>` tags configured on the OpenSearch highlighter
 * are preserved through the server-side escape and extracted by regex here.
 *
 * `&amp;` must be replaced LAST so the pass is single-decode: an input of
 * `&amp;lt;` decodes to `&lt;` (the original characters the user typed), not
 * `<` (which would happen if `&amp;` ran first and then `&lt;` matched).
 *
 * IMPORTANT: this only decodes fields the server actually escaped. Do NOT run
 * it over shared snippet paths (e.g. `MessageHit.Snippet` from `/_search`,
 * `/_search_all`, `_search_global_messages`, `_search_global_groups` top_hits)
 * — those are raw on the wire and decoding them corrupts intentionally-typed
 * ampersands, angle-brackets, etc. in message bodies. Decode at the mapper
 * boundary for the specific fields whose contract says "server-escaped".
 */
export function decodeServerEscapedHighlight(input: string): string {
  if (!input) return input;
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

export type ChannelSearchSnippetToken =
  | {
      type: "text";
      text: string;
      highlighted: boolean;
    }
  | {
      type: "emoji";
      key: string;
      url: string;
      highlighted: boolean;
    };

export function parseChannelSearchSnippetHighlights(text = "", keyword = "") {
  const markPattern = /<mark>([\s\S]*?)<\/mark>/gi;
  const ranges: HighlightRange[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let plainLength = 0;
  let match: RegExpExecArray | null;

  while ((match = markPattern.exec(text))) {
    if (match.index > cursor) {
      // Encoding-agnostic: caller decodes at the mapper boundary for fields
      // whose contract says "server-escaped" (currently NameHighlight and
      // ContentSnippet on FileHit). Pre-existing shared paths (MessageHit
      // .Snippet, richText, mergeForward) stay raw and are passed through
      // verbatim, so a genuine `&amp;` a user typed in a message body is
      // preserved instead of silently rewritten to `&`.
      const plainText = text.slice(cursor, match.index);
      parts.push(plainText);
      plainLength += plainText.length;
    }

    const markedText = match[1];
    const start = plainLength;
    parts.push(markedText);
    plainLength += markedText.length;
    ranges.push({ start, end: start + markedText.length });
    cursor = markPattern.lastIndex;
  }

  if (ranges.length > 0) {
    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }
    return {
      text: parts.join(""),
      ranges: mergeHighlightRanges(ranges),
    };
  }

  const needle = keyword.trim();
  if (!needle) {
    return { text, ranges };
  }

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let index = lowerText.indexOf(lowerNeedle);
  while (index !== -1) {
    ranges.push({ start: index, end: index + needle.length });
    index = lowerText.indexOf(lowerNeedle, index + needle.length);
  }

  return {
    text,
    ranges: mergeHighlightRanges(ranges),
  };
}

function mergeHighlightRanges(ranges: HighlightRange[]) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];

  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && range.start <= prev.end) {
      prev.end = Math.max(prev.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function rangeIntersectsHighlight(
  start: number,
  end: number,
  ranges: HighlightRange[]
) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function pushToken(
  tokens: ChannelSearchSnippetToken[],
  token: ChannelSearchSnippetToken
) {
  const prev = tokens[tokens.length - 1];
  if (
    token.type === "text" &&
    prev?.type === "text" &&
    prev.highlighted === token.highlighted
  ) {
    prev.text += token.text;
    return;
  }
  tokens.push(token);
}

function pushTextTokens(
  tokens: ChannelSearchSnippetToken[],
  text: string,
  start: number,
  end: number,
  ranges: HighlightRange[]
) {
  let cursor = start;

  for (const range of ranges) {
    if (range.end <= cursor) continue;
    if (range.start >= end) break;

    const highlightStart = Math.max(range.start, cursor);
    const highlightEnd = Math.min(range.end, end);

    if (highlightStart > cursor) {
      pushToken(tokens, {
        type: "text",
        text: text.slice(cursor, highlightStart),
        highlighted: false,
      });
    }

    if (highlightEnd > highlightStart) {
      pushToken(tokens, {
        type: "text",
        text: text.slice(highlightStart, highlightEnd),
        highlighted: true,
      });
    }
    cursor = highlightEnd;
  }

  if (cursor < end) {
    pushToken(tokens, {
      type: "text",
      text: text.slice(cursor, end),
      highlighted: false,
    });
  }
}

function toSearchableEmojiRegExp(emojiRegExp: RegExp) {
  const flags = emojiRegExp.flags.replace(/[gy]/g, "");
  return new RegExp(emojiRegExp.source, flags);
}

export function buildChannelSearchSnippetTokens(
  text: string,
  ranges: HighlightRange[],
  resolveEmojiUrl: (key: string) => string,
  emojiRegExp?: RegExp
) {
  const tokens: ChannelSearchSnippetToken[] = [];
  if (!text) return tokens;
  if (!emojiRegExp) {
    pushTextTokens(tokens, text, 0, text.length, ranges);
    return tokens;
  }

  let cursor = 0;
  let rest = text;
  const searchableEmojiRegExp = toSearchableEmojiRegExp(emojiRegExp);

  while (rest.length > 0) {
    const match = rest.match(searchableEmojiRegExp);
    const matchIndex = match?.index;
    const matchedText = match?.[0];

    if (matchIndex === undefined || !matchedText || matchedText.length === 0) {
      break;
    }

    const start = cursor + matchIndex;
    const end = start + matchedText.length;
    if (start > cursor) {
      pushTextTokens(tokens, text, cursor, start, ranges);
    }

    const emojiUrl = resolveEmojiUrl(matchedText);
    if (emojiUrl) {
      pushToken(tokens, {
        type: "emoji",
        key: matchedText,
        url: emojiUrl,
        highlighted: rangeIntersectsHighlight(start, end, ranges),
      });
    } else {
      pushTextTokens(tokens, text, start, end, ranges);
    }

    cursor = end;
    rest = text.slice(cursor);
  }

  if (cursor < text.length) {
    pushTextTokens(tokens, text, cursor, text.length, ranges);
  }

  return tokens;
}

type ChannelSearchSnippetContentProps = {
  text?: string;
  keyword: string;
};

const ChannelSearchSnippetContent = React.memo(
  function ChannelSearchSnippetContent({
    text = "",
    keyword,
  }: ChannelSearchSnippetContentProps) {
    const tokens = useMemo(() => {
      const parsed = parseChannelSearchSnippetHighlights(text, keyword);
      return buildChannelSearchSnippetTokens(
        parsed.text,
        parsed.ranges,
        (key) => WKApp.emojiService.getImage(key),
        WKApp.emojiService.emojiRegExp()
      );
    }, [keyword, text]);

    return (
      <>
        {tokens.map((token, index) => {
          if (token.type === "emoji") {
            const emoji = (
              <span className="wk-channel-search-snippet-emoji">
                <img alt={token.key} src={token.url} />
              </span>
            );
            if (!token.highlighted) {
              return React.cloneElement(emoji, { key: index });
            }
            return (
              <mark
                key={index}
                className="wk-channel-search-highlight wk-channel-search-highlight--emoji"
              >
                {emoji}
              </mark>
            );
          }

          if (!token.highlighted) {
            return <React.Fragment key={index}>{token.text}</React.Fragment>;
          }
          return (
            <mark key={index} className="wk-channel-search-highlight">
              {token.text}
            </mark>
          );
        })}
      </>
    );
  }
);

export default ChannelSearchSnippetContent;
