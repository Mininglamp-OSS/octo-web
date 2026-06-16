export type MentionClassName =
  | "mention-fallback"
  | "mention-highlight"
  | "mention-entity";

export interface MentionRenderState {
  className: MentionClassName;
  interactive: boolean;
}

export function getMentionRenderState(uid?: string): MentionRenderState {
  if (uid === "all") {
    return { className: "mention-entity", interactive: false };
  }
  if (uid === "channel") {
    return { className: "mention-highlight", interactive: false };
  }
  if (uid) {
    return { className: "mention-entity", interactive: true };
  }
  return { className: "mention-fallback", interactive: false };
}
