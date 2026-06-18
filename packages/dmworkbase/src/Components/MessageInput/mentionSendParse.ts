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

// uid + name (`[^:]+`), label (`[^\]]+`). The uid group also captures a leading
// MENTION_TRUST_MARK when the serializer tagged a node-origin sentinel.
const MARKER_PATTERN = /@\[([^:]+):([^\]]+)\]/g;

/**
 * Parse a serialized send string into `{ content, mention }`. Broadcast
 * sentinels are routed only when carried by a trust-marked (node-origin) uid;
 * untrusted sentinels degrade to plain text. Pure: no module/editor state.
 */
export function parseSendMentionText(
  text: string,
  members: ReadonlyArray<SendParseMember> = []
): ParseSendMentionResult {
  const entities: ParsedMentionEntity[] = [];
  const uids: string[] = [];
  let result = "";
  let cursor = 0;
  let all = false;
  let humans = false;
  let ais = false;

  MARKER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_PATTERN.exec(text)) !== null) {
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

    // Ordinary member: canonical display name, falling back to the matched
    // label when the member is unknown (parity with the input-box chip).
    const member = members.find((m) => m.uid === uid);
    const resolved = member ? subscriberDisplayName(member) : "";
    const atName = resolved ? `@${resolved}` : `@${name}`;
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
