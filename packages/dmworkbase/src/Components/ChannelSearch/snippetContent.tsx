import React, { useMemo } from "react";
import WKApp from "../../App";

type HighlightRange = {
  start: number;
  end: number;
};

/**
 * Re-exported from `../../Service/decodeServerEscapedHighlight` (a dep-free
 * Service-layer module) so downstream data-layer callers can consume this
 * helper without pulling React/App into their test boundaries. That module
 * carries the full behavioural contract — see its top-of-file comment.
 */
export { decodeServerEscapedHighlight } from "../../Service/decodeServerEscapedHighlight";

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
