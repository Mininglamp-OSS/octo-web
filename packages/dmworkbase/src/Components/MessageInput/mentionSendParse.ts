/**
 * Send-boundary parser for the `@[uid:label]` mention grammar (octo-web#330).
 *
 * Extracted from `MessageInput/index.tsx`'s `formatMentionTextV2` so the send
 * boundary can be unit-tested in isolation and so the security-critical
 * broadcast-routing decision lives in one pure, reviewable place.
 *
 * ## The trust boundary
 *
 * On send, the editor is serialized to a flat string in which a real mention
 * *node* (inserted only by the typed-@ dropdown — the sole sanctioned origin)
 * becomes `@[uid:label]`. The problem: arbitrary literal text — pasted forged
 * clipboard HTML that degraded to plain text, or a user simply typing
 * `@[-2:所有人]` — serializes to the *identical* string. A naive re-parse
 * therefore lets untrusted text route a broadcast sentinel (`-1`/`-2`/`-3`),
 * fanning a message out to every human / AI in the channel.
 *
 * The serializer resolves this by prefixing a sentinel uid with
 * {@link MENTION_TRUST_MARK} only for node-origin mentions, and stripping that
 * mark from all text-origin content. This parser honors a broadcast *only* when
 * the mark is present, then consumes it. A broadcast-sentinel marker that
 * arrives without the mark (i.e. from literal text) is degraded to inert
 * `@label` text — no flags, no entity, no bot fan-out.
 *
 * Non-broadcast member uids are not gated here: forged member mentions are
 * already failed-closed at paste time by the clipboard allowlist
 * (`buildInlineContentForRichTextPaste`), and they cannot fan out a broadcast.
 */

import { subscriberDisplayName } from "../../Utils/displayName";
import type { SubscriberLike } from "../../Utils/displayName";
import {
  MENTION_UID_LEGACY_ALL,
  MENTION_UID_HUMANS,
  MENTION_UID_AIS,
  MENTION_LABEL_HUMANS,
  MENTION_LABEL_AIS,
  MENTION_TRUST_MARK,
  isBroadcastSentinelUid,
} from "../../Utils/mentionRender";

export interface ParsedMentionEntity {
  uid: string;
  offset: number;
  length: number;
}

export interface ParsedSendMention {
  all: boolean;
  humans: boolean;
  ais: boolean;
  uids: string[];
  entities: ParsedMentionEntity[];
}

export interface ParseSendMentionResult {
  content: string;
  mention?: ParsedSendMention;
}

/** Structural member shape used for display-name resolution + bot fan-out. */
export type SendParseMember = SubscriberLike & {
  uid: string;
  orgData?: SubscriberLike["orgData"] & { robot?: number };
};

/**
 * Parse a serialized send string into `{ content, mention }`. Broadcast
 * sentinels are routed only when carried by a trust-marked (node-origin) uid;
 * untrusted sentinels degrade to plain text. Pure: no module/editor state.
 */
export function parseSendMentionText(
  text: string,
  members: ReadonlyArray<SendParseMember> = []
): ParseSendMentionResult {
  // uid + name (`[^:]+`), label (`[^\]]+`). The uid group also captures a
  // leading MENTION_TRUST_MARK when the serializer tagged a node-origin
  // sentinel. Function-local so its `g`-flag `lastIndex` can never leak
  // between calls.
  const markerPattern = /@\[([^:]+):([^\]]+)\]/g;
  const entities: ParsedMentionEntity[] = [];
  const uids: string[] = [];
  let result = "";
  let cursor = 0;
  let all = false;
  let humans = false;
  let ais = false;

  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(text)) !== null) {
    const rawUid = match[1];
    const name = match[2];

    const trusted = rawUid.startsWith(MENTION_TRUST_MARK);
    const uid = trusted ? rawUid.slice(MENTION_TRUST_MARK.length) : rawUid;

    // text before this marker
    result += text.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    if (isBroadcastSentinelUid(uid)) {
      if (!trusted) {
        // Untrusted broadcast sentinel decoded from literal `@[uid:label]`
        // text — the core octo-web#330 bypass. Never route it; emit the
        // label as inert plain text (mirrors the paste-time degrade).
        result += `@${name}`;
        continue;
      }
      if (uid === MENTION_UID_LEGACY_ALL) {
        // legacy @所有人 → all=1 (server rewrites to humans=1)
        all = true;
        result += `@${MENTION_LABEL_HUMANS}`;
      } else if (uid === MENTION_UID_HUMANS) {
        humans = true;
        result += `@${MENTION_LABEL_HUMANS}`;
      } else {
        // MENTION_UID_AIS (the render-only "all" sentinel is never produced
        // by the send serializer, so any trusted sentinel here is @所有AI).
        ais = true;
        const atName = `@${MENTION_LABEL_AIS}`;
        entities.push({ uid, offset: result.length, length: atName.length });
        result += atName;
      }
      continue;
    }

    // Ordinary member: route ONLY when the uid is a current channel member.
    // A forged / unknown / stale uid carried by text-origin `@[uid:label]`
    // (e.g. a clipboard payload that drops `@[attacker:Alice]` straight into
    // the text with no structured mention metadata) degrades to inert `@label`
    // text — the same fail-closed contract as the paste-time allowlist and the
    // broadcast degrade. Without this the send-side re-parse re-introduces the
    // forged member mentions the paste guard had dropped (octo-web#330).
    const member = members.find((m) => m.uid === uid);
    if (!member) {
      result += `@${name}`;
      continue;
    }
    const atName = `@${subscriberDisplayName(member) || name}`;
    uids.push(uid);
    entities.push({ uid, offset: result.length, length: atName.length });
    result += atName;
  }

  result += text.slice(cursor);

  if (!(all || humans || ais || entities.length > 0)) {
    return { content: result };
  }

  if (ais) {
    // GH#100: expand bot member UIDs into mention.uids so legacy adapter bots
    // (which only check mention.uids, not mention.ais) still recognise the
    // @所有AI broadcast. Client messages go via WuKongIM SDK direct, so the
    // server-side expansion (octo-server PR#145) does not apply to them.
    const botUids = members
      .filter((m) => m.orgData?.robot === 1)
      .map((m) => m.uid)
      .filter((u) => !uids.includes(u));
    uids.push(...botUids);
  }

  return {
    content: result,
    mention: { all, humans, ais, uids, entities },
  };
}

// ─── Serialization helpers (the trust-boundary primitives) ────────────────

// Serialize a mention NODE to its `@[uid:label]` marker. A mention node is the
// only sanctioned broadcast origin (typed-@ dropdown), so when serializing for
// SEND we tag a broadcast-sentinel uid with MENTION_TRUST_MARK; the send-side
// parser routes a broadcast only for trust-marked uids. Member uids and the
// non-send (draft) path stay canonical (octo-web#330).
export function serializeMentionMarker(
  id: string,
  label: string,
  trusted: boolean
): string {
  const uid =
    trusted && isBroadcastSentinelUid(id) ? `${MENTION_TRUST_MARK}${id}` : id;
  return `@[${uid}:${label}]`;
}

// Remove the internal trust mark from text-origin content so forged/typed text
// can never carry it into a routable broadcast marker (octo-web#330). This is
// the linchpin of the "cannot forge trust" guarantee: every untrusted → string
// path must run through it.
export function stripTrustMark(text: string): string {
  return text.includes(MENTION_TRUST_MARK)
    ? text.split(MENTION_TRUST_MARK).join("")
    : text;
}

// ─── Draft deserialization ────────────────────────────────────────────────

export interface DraftDocNode {
  type: string;
  text?: string;
  attrs?: { id: string; label: string };
}
export interface DraftDoc {
  type: "doc";
  content: Array<{ type: "paragraph"; content: DraftDocNode[] }>;
}

/**
 * Parse persisted draft text back into a Tiptap doc (one paragraph per line).
 *
 * SECURITY (octo-web#330, Finding 1): a draft is untrusted text — it is the
 * verbatim `text()` serialization, which includes forged `@[uid:label]` strings
 * that the paste guard had degraded to inert text. This deserializer must NOT
 * reconstruct a broadcast-sentinel marker into a mention *node*, or the draft
 * save → restore round-trip would launder forged text into a "trusted"
 * node that `extractOrderedBlocks` then serializes with the trust mark and the
 * send parser routes as a broadcast. So a sentinel uid fails closed to inert
 * `@label` text (mirrors `richTextPaste.ts` and the send-side degrade). The
 * trust mark is also stripped before the sentinel check so a hand-injected
 * `@[\u0000-2:label]` cannot slip past as a non-sentinel uid.
 *
 * Tradeoff: a broadcast the user picked from the dropdown, saved as a draft,
 * and restored also degrades to inert text — a fail-closed UX nick, not a
 * security loss. The plain typed-@ → send path (no draft) is unaffected.
 */
export function parseDraftToContent(text: string): DraftDoc {
  const lines = text.split("\n");
  const paragraphs = lines.map((line) => {
    const nodes: DraftDocNode[] = [];

    // uid and label may contain any char except `]`.
    const regex = /@\[([^\]:]+):([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      const uid = stripTrustMark(match[1]);
      const label = match[2];
      const matchStart = match.index;

      if (matchStart > lastIndex) {
        nodes.push({ type: "text", text: line.slice(lastIndex, matchStart) });
      }

      if (isBroadcastSentinelUid(uid)) {
        // Fail closed: never rebuild a broadcast sentinel as a node from
        // untrusted draft text — emit inert `@label` text instead.
        nodes.push({ type: "text", text: `@${label}` });
      } else {
        nodes.push({ type: "mention", attrs: { id: uid, label } });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      nodes.push({ type: "text", text: line.slice(lastIndex) });
    }

    return { type: "paragraph" as const, content: nodes };
  });

  return { type: "doc", content: paragraphs };
}
