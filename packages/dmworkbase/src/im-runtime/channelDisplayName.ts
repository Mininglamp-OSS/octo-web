import type { ImChannelInfoLike } from "./channelRuntime";

function nonemptyName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getImChannelDisplayName(info?: ImChannelInfoLike | null): string {
  for (const value of [info?.orgData?.remark, info?.orgData?.displayName]) {
    const name = nonemptyName(value);
    if (name) return name;
  }
  // Older host seeds used the channel ID as a synthetic title.
  const title = nonemptyName(info?.title);
  return title !== info?.channel?.channelID ? title : "";
}

/** Host hints supplement server metadata; they must not erase a user's remark. */
export function seedImChannelDisplayName(
  info: ImChannelInfoLike,
  displayName?: string,
  metadata?: Record<string, unknown>,
): void {
  const previousName = getImChannelDisplayName(info);
  const remark = nonemptyName(info.orgData?.remark) || nonemptyName(metadata?.remark);
  const incomingName = nonemptyName(displayName) || nonemptyName(metadata?.displayName);
  if (incomingName) info.title = incomingName;
  const name = remark || incomingName || previousName;
  info.orgData = {
    ...info.orgData,
    ...metadata,
    ...(remark ? { remark } : {}),
    ...(name ? { displayName: name } : {}),
  };
}
