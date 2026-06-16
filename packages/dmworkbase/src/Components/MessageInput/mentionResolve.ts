/**
 * Pure name/mention resolution helpers for the voice-transcription @-matching
 * path. Extracted from MessageInput/index.tsx so the editor component and unit
 * tests share a single source of truth (no mirrored copy in the test file).
 *
 * Kept free of React / DOM / SDK imports so it loads cleanly in a plain TS
 * test environment.
 */
import { isRealnameVerified, subscriberDisplayName } from "../../Utils/displayName";
import {
  MENTION_UID_HUMANS,
  MENTION_UID_AIS,
  MENTION_LABEL_HUMANS,
  MENTION_LABEL_AIS,
} from "../../Utils/mentionRender";

export interface MemberInfo {
  uid: string;
  // 用于正则匹配的候选名字（可能是别名：群昵称 / 昵称 / 实名）
  name: string;
  // 该 uid 的规范展示名（real_name(verified) → remark → name），同一 uid 的
  // 所有候选共享同一个 label，命中任意别名后 chip 都渲染这个规范名。
  label: string;
}

/** Structural shape of a group member used to build mention candidates. */
export interface MemberInfoSource {
  uid: string;
  name?: string;
  remark?: string;
  orgData?: {
    real_name?: string | null;
    realname_verified?: boolean | number | string | null;
    robot?: number;
  } | null;
}

// Build the list of @-mention candidates for the given members. Each member can
// contribute up to three candidates (群昵称/remark, 昵称/name, 实名/real_name),
// all bound to the same uid; the real_name candidate is only added for verified
// non-bot members and is deduped against the other two.
export function buildMemberInfos(
  members?: ReadonlyArray<MemberInfoSource>
): MemberInfo[] {
  const infos: MemberInfo[] = [];
  if (members) {
    for (const s of members) {
      // 规范展示名：real_name(verified) → remark → name，与气泡/成员列表一致。
      const label = subscriberDisplayName(s) || s.uid;
      const primary = s.remark || s.name || s.uid;
      infos.push({ uid: s.uid, name: primary, label });
      if (s.name && s.remark && s.remark !== s.name) {
        infos.push({ uid: s.uid, name: s.name, label });
      }
      // 实名候选：仅非 bot 且已实名；去重，避免与上面重复
      const orgData = s.orgData;
      const isBot = orgData?.robot === 1;
      const verified =
        !isBot &&
        isRealnameVerified({ realname_verified: orgData?.realname_verified });
      const realName = verified ? (orgData?.real_name ?? "").trim() : "";
      if (realName && realName !== primary && realName !== s.name) {
        infos.push({ uid: s.uid, name: realName, label });
      }
    }
  }
  return infos;
}

// Escape special regex characters in a string
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a dynamic regex that matches @name for all known members.
// Names are sorted longest-first so "Cindy Che" matches before "Cindy".
export function buildMentionRegex(members: MemberInfo[]): RegExp {
  const specialNames = [MENTION_LABEL_HUMANS, "all", "everyone", MENTION_LABEL_AIS, "All AIs"];
  const allNames = [...specialNames, ...members.map((m) => m.name)];
  // Deduplicate and sort by length descending (longest match first)
  const unique = [...new Set(allNames)];
  unique.sort((a, b) => b.length - a.length);
  const pattern = unique.map(escapeRegExp).join("|");
  // Boundary: whitespace, CJK punctuation, or end of string
  return new RegExp(`@(${pattern})(?=[\\s，。！？,!?]|$)`, "gi");
}

// Parse voice-transcribed text for @mentions, converting to Tiptap content
export function parseMentionMarkers(
  text: string,
  members: MemberInfo[]
): Array<{
  type: string;
  text?: string;
  attrs?: { id: string; label: string };
}> {
  const result: Array<{
    type: string;
    text?: string;
    attrs?: { id: string; label: string };
  }> = [];
  const regex = buildMentionRegex(members);
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const matchStart = match.index;

    if (matchStart > lastIndex) {
      result.push({ type: "text", text: text.slice(lastIndex, matchStart) });
    }

    const isHumans =
      name === MENTION_LABEL_HUMANS ||
      name.toLowerCase() === "all" ||
      name.toLowerCase() === "everyone";
    const isAis =
      name === MENTION_LABEL_AIS || name.toLowerCase() === "all ais";
    const member = members.find(
      (m) => m.name.toLowerCase() === name.toLowerCase()
    );

    if (isHumans) {
      result.push({
        type: "mention",
        attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
      });
      result.push({ type: "text", text: " " });
    } else if (isAis) {
      result.push({
        type: "mention",
        attrs: { id: MENTION_UID_AIS, label: MENTION_LABEL_AIS },
      });
      result.push({ type: "text", text: " " });
    } else if (member) {
      result.push({
        type: "mention",
        attrs: { id: member.uid, label: member.label },
      });
      result.push({ type: "text", text: " " });
    } else {
      // Unrecognized @, keep as plain text
      result.push({ type: "text", text: match[0] });
    }

    lastIndex = match.index + match[0].length;
    if (isHumans || isAis || member) {
      if (lastIndex < text.length && /\s/.test(text[lastIndex])) {
        lastIndex++;
      }
    }
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", text: text.slice(lastIndex) });
  }

  return result;
}
