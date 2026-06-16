import {
  buildMessageMentions,
  readMentionFlags,
  type MentionRenderInfo,
  type MentionRenderPart,
} from "../../Utils/mentionRender";

export function buildTextMessageMentions(args: {
  parts: MentionRenderPart[];
  content: unknown;
  editContent?: unknown;
  partMentionType: number;
}): MentionRenderInfo[] {
  const flags =
    readMentionFlags(args.editContent) ?? readMentionFlags(args.content);

  return buildMessageMentions(args.parts, flags, args.partMentionType);
}
