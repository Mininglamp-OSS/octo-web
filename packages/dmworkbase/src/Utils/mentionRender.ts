/**
 * Shared render-side helpers for the three-state mention model
 * (`@所有人` / `@所有AI` / member, with legacy `mention.all=1` support).
 *
 * Lives in Utils so both the production `Conversation.getMessageMentions`
 * path and unit tests can exercise the same synthesis logic instead of
 * maintaining a copy in the test file.
 *
 * Inputs are kept structural so the helper does not depend on any SDK
 * type that is unfriendly to plain TS test environments.
 */

export interface MentionRenderInfo {
  /** Visible mention label including the leading "@" (matched by MarkdownContent). */
  name: string;
  /** Member uid, or the sentinel string `"all"` for synthetic highlights. */
  uid: string;
}

export interface MentionRenderPart {
  type: number;
  text: string;
  data?: { uid?: string };
}

export interface MentionRenderFlags {
  all?: boolean | number;
  humans?: number;
  ais?: number;
}

/**
 * Build the render-time MentionInfo[] for a message: combine ordinary
 * `@member` parts with synthetic `@所有人` / `@所有AI` entries derived
 * from the three-state mention flags. Synthetic entries reuse the
 * `uid: "all"` sentinel so MarkdownContent can keep them non-clickable
 * while applying the same visual style as ordinary member mentions.
 *
 * Dedup is by visible name — if the conversation already contains a
 * literal `@所有人` member part (rare; admins can rename members), the
 * member entry wins and the synthetic broadcast highlight is dropped.
 *
 * The `partMentionType` argument is the numeric enum value for
 * `Part.type === PartType.mention`. We accept it as a parameter so the
 * helper does not have to import the SDK PartType (which would pull in
 * heavy SDK deps from the test runtime).
 */
export function buildMessageMentions(
  parts: MentionRenderPart[] | undefined,
  flags: MentionRenderFlags | undefined,
  partMentionType: number,
): MentionRenderInfo[] {
  const base: MentionRenderInfo[] =
    parts
      ?.filter((p) => p.type === partMentionType && p.data?.uid)
      .map((p) => ({ name: p.text, uid: p.data!.uid! })) ?? [];

  if (!flags) return base;

  const all = flags.all === true || flags.all === 1;
  // Plan X: when ais flag is set, all=1 is a backward-compat artifact of the
  // server rewrite (legacy @所有人 → ais=1 + preserve all=1). Do not render
  // the @所有人 pill from all alone when ais is present — only render it from
  // explicit humans=1.
  const highlightAll = !!flags.humans || (!flags.ais && all);
  const highlightAis = !!flags.ais;

  const synthetic: MentionRenderInfo[] = [];
  if (highlightAll) synthetic.push({ name: "@所有人", uid: "all" });
  if (highlightAis) synthetic.push({ name: "@所有AI", uid: "all" });

  const seen = new Set(base.map((m) => m.name));
  for (const s of synthetic) {
    if (!seen.has(s.name)) {
      base.push(s);
      seen.add(s.name);
    }
  }
  return base;
}

/**
 * Read the three-state mention flags off a message content object,
 * preferring the SDK-decoded `mention.{humans,ais,all}` and falling
 * back to the raw `contentObj.mention.{humans,ais,all}` shape used on
 * the wire (where the SDK has not been taught about the new fields).
 *
 * Accepts `unknown` so callers do not need to add `as any` at the call
 * site for either the SDK or the raw decoded JSON.
 */
export function readMentionFlags(
  content: unknown,
): MentionRenderFlags | undefined {
  if (!content || typeof content !== "object") return undefined;
  const c = content as {
    mention?: MentionRenderFlags;
    contentObj?: { mention?: MentionRenderFlags };
  };
  const mn = c.mention;
  const contentObjMn = c.contentObj?.mention;
  if (!mn && !contentObjMn) return undefined;
  return {
    all: mn?.all ?? contentObjMn?.all,
    humans: mn?.humans ?? contentObjMn?.humans,
    ais: mn?.ais ?? contentObjMn?.ais,
  };
}

// ─── Send-side dropdown helpers (used by MessageInput) ────────────

// Sentinel uids used by the @-dropdown sticky top items + voice transcription.
// `-1` is the legacy "@所有人" (mention.all=1). `-2` / `-3` are the new
// three-state sentinels (mention.humans=1 / mention.ais=1).
export const MENTION_UID_LEGACY_ALL = "-1";
export const MENTION_UID_HUMANS = "-2";
export const MENTION_UID_AIS = "-3";
export const MENTION_LABEL_HUMANS = "所有人";
export const MENTION_LABEL_AIS = "所有AI";

// Render-side synthetic uid used by `buildMessageMentions` for non-clickable
// broadcast highlights. Not a wire/routing uid, but it must be treated as a
// broadcast sentinel by the paste/render guards so a forged clipboard payload
// cannot smuggle it back into a routable mention node.
export const MENTION_UID_RENDER_ALL = "all";

/**
 * A broadcast-routing sentinel fans a single message out to every human / AI
 * in the channel. Untrusted sources (clipboard HTML, literal `@[uid:label]`
 * text the user typed/pasted) must never be allowed to decode one — only a
 * sanctioned structured mention (the typed-@ dropdown, which inserts a real
 * editor mention node) may. Grafted from octo-web#361 so the paste guard, the
 * send-side re-parse, and the render path all share one definition instead of
 * each maintaining a private set (octo-web#330).
 */
export function isBroadcastSentinelUid(uid: string): boolean {
  return (
    uid === MENTION_UID_LEGACY_ALL ||
    uid === MENTION_UID_HUMANS ||
    uid === MENTION_UID_AIS ||
    uid === MENTION_UID_RENDER_ALL
  );
}

// Internal control char that tags a broadcast-sentinel marker as originating
// from a sanctioned editor mention node (typed-@ dropdown) rather than from
// untrusted literal text. The send serializer prefixes a sentinel uid with this
// mark for node-origin mentions and strips it from all text-origin content, so
// a forged/typed `@[-2:label]` string cannot carry it. The send-side parser
// honors a broadcast only when the mark is present, then consumes it — it is
// never persisted to drafts and never reaches the wire/recipient text.
export const MENTION_TRUST_MARK = "\u0000";

export type MentionUidState = "bot" | "user" | "unknown";

export function mentionUidStateFromRobot(robot: unknown): MentionUidState {
  if (robot === 1) return "bot";
  if (robot === 0) return "user";
  return "unknown";
}

/**
 * Dropdown item shape returned by the @-mention suggestion factory.
 * Exported so unit tests can assert the exact selection order and
 * lock the keyboard-Enter regression that landed in PR #59.
 */
export interface MentionDropdownItem {
  uid: string;
  name: string;
  icon: string;
  isBot: boolean;
  sourceSpaceName: string;
}

/**
 * Pure helper that builds the @-mention dropdown items for a given
 * query + member list. Extracted from the inline suggestion factory
 * in `MessageInput/index.tsx` so the keyboard-selection regression
 * (typing `@Bob` + Enter must select Bob, not the sticky `@所有人`)
 * can be locked in a unit test without spinning up the editor.
 *
 * Sticky behavior: `@所有人` and `@所有AI` are prepended **only when
 * the query is empty**. As soon as the user types a filter the
 * dropdown shows only matching members, so `MentionList`'s default
 * `selectedIndex = 0` correctly lands on the first member match and
 * Enter inserts the typed member instead of broadcasting to everyone.
 * Callers can set `includeBroadcastMentions=false` for direct chats,
 * where broadcasting to everyone or all AIs does not make sense.
 *
 * `iconResolver` and `externalResolver` are injected so callers can
 * pass the production avatar lookup / external-space resolver, while
 * tests can pass cheap stubs.
 */
export function buildMentionDropdownItems<
  M extends {
    uid: string;
    name: string;
    orgData?: {
      home_space_id?: string;
      home_space_name?: string;
      is_external?: boolean;
      source_space_name?: string;
      robot?: number;
    };
  },
>(args: {
  query: string;
  members: M[] | null | undefined;
  iconResolver: (member: M) => string;
  externalResolver: (member: M) => {
    isExternal: boolean;
    sourceSpaceName: string;
  };
  stickyIcon: string;
  includeBroadcastMentions?: boolean;
}): MentionDropdownItem[] {
  const {
    query,
    members,
    iconResolver,
    externalResolver,
    stickyIcon,
    includeBroadcastMentions = true,
  } = args;

  const trimmedQuery = (query ?? "").trim();
  const stickyTop: MentionDropdownItem[] =
    includeBroadcastMentions && trimmedQuery.length === 0
      ? [
          {
            uid: MENTION_UID_HUMANS,
            name: MENTION_LABEL_HUMANS,
            icon: stickyIcon,
            isBot: false,
            sourceSpaceName: "",
          },
          {
            uid: MENTION_UID_AIS,
            name: MENTION_LABEL_AIS,
            icon: stickyIcon,
            isBot: true,
            sourceSpaceName: "",
          },
        ]
      : [];

  if (!members) return stickyTop;

  const items: MentionDropdownItem[] = members.map((member) => {
    const ext = externalResolver(member);
    return {
      uid: member.uid,
      name: member.name,
      icon: iconResolver(member),
      // 直接从 Subscriber.orgData 取，不依赖 channelInfo 缓存是否已热
      isBot: member.orgData?.robot === 1,
      sourceSpaceName: ext.isExternal ? ext.sourceSpaceName : "",
    };
  });

  const filteredMembers = items.filter((item) =>
    item.name.toLowerCase().includes(trimmedQuery.toLowerCase()),
  );

  return [...stickyTop, ...filteredMembers];
}
