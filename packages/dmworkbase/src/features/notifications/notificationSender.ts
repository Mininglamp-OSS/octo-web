import WKSDK, { Channel, ChannelTypeGroup, ChannelTypePerson, type Message } from "wukongimjssdk";
import { getImChannelInfo, getImChannelSubscribers } from "../../im-runtime/channelRuntime";
import { personalRemarkDisplayName, subscriberDisplayName } from "../../Utils/displayName";
import { t } from "../../i18n";

/** Read sender identity independently of the conversation title and message body. */
export function getNotificationSenderName(message: Pick<Message, "fromUID" | "channel">): string {
  const sdk = WKSDK.shared();
  const person = message.fromUID
    ? getImChannelInfo(sdk, new Channel(message.fromUID, ChannelTypePerson))
    : undefined;
  const remark = personalRemarkDisplayName(person);
  if (remark) return remark;
  if (message.channel.channelType === ChannelTypeGroup) {
    const member = getImChannelSubscribers(sdk, message.channel).find(value => value.uid === message.fromUID);
    const name = subscriberDisplayName(member);
    if (name) return name;
  }
  // An incomplete cache must not turn a UID or message preview into a display name.
  return person?.orgData?.displayName || person?.title || t("base.notification.user");
}
