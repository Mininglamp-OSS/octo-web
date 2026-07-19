import {
  ChannelTypePerson,
  type Channel,
  type ChannelInfo,
  type Subscriber,
} from "wukongimjssdk";

export function userInfoMembershipOrgData(args: {
  fromChannel?: Channel;
  channelInfo?: ChannelInfo;
  fromSubscriberOfUser?: Subscriber;
}): Record<string, any> | undefined {
  if (args.fromSubscriberOfUser?.orgData) {
    return args.fromSubscriberOfUser.orgData as Record<string, any>;
  }
  if (!args.fromChannel || args.fromChannel.channelType === ChannelTypePerson) {
    return undefined;
  }
  return args.channelInfo?.orgData as Record<string, any> | undefined;
}

export function userInfoMembershipCreatedAt(
  orgData?: Record<string, any>
): string {
  const createdAt = orgData?.created_at;
  return typeof createdAt === "string" && createdAt !== "" ? createdAt : "";
}
