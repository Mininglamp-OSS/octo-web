import {
  isBroadcastSentinelUid,
  MENTION_TRUST_MARK,
} from "../../../Utils/mentionProtocol";

export function serializeMentionMarker(
  id: string,
  label: string,
  trusted: boolean,
): string {
  const uid =
    trusted && isBroadcastSentinelUid(id) ? `${MENTION_TRUST_MARK}${id}` : id;
  return `@[${uid}:${label}]`;
}

export function stripTrustMark(text: string): string {
  return text.includes(MENTION_TRUST_MARK)
    ? text.split(MENTION_TRUST_MARK).join("")
    : text;
}
