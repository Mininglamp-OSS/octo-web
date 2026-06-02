import { ChannelTypeCommunityTopic, GroupRole } from "./Const";
import { ChannelTypeGroup } from "wukongimjssdk";

export interface RevokeMenuPermissionInput {
  messageID?: string;
  channelType?: number;
  messageSend?: boolean;
  messageTimestamp?: number;
  revokeSecond?: number;
  nowSeconds?: number;
  isBotOwner?: boolean;
  myRole?: number;
  targetRole?: number;
}

export function isWithinRevokeWindow(input: {
  messageTimestamp?: number;
  revokeSecond?: number;
  nowSeconds?: number;
}): boolean {
  const revokeSecond = input.revokeSecond ?? 0;
  if (revokeSecond <= 0) {
    return true;
  }
  const messageTimestamp = input.messageTimestamp ?? 0;
  const nowSeconds = input.nowSeconds ?? Date.now() / 1000;
  return nowSeconds - messageTimestamp <= revokeSecond;
}

export function canShowRevokeMenu(input: RevokeMenuPermissionInput): boolean {
  if (!input.messageID) {
    return false;
  }

  if (input.isBotOwner) {
    return true;
  }

  const isGroupLike =
    input.channelType === ChannelTypeGroup ||
    input.channelType === ChannelTypeCommunityTopic;

  if (isGroupLike) {
    if (input.myRole === GroupRole.owner) {
      return true;
    }

    if (input.myRole === GroupRole.manager) {
      if (input.messageSend) {
        return isWithinRevokeWindow(input);
      }

      if (input.targetRole == null) {
        return false;
      }

      return (
        input.targetRole !== GroupRole.owner &&
        input.targetRole !== GroupRole.manager
      );
    }

    if (!input.messageSend) {
      return false;
    }
  } else if (!input.messageSend) {
    return false;
  }

  return isWithinRevokeWindow(input);
}
