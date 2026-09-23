import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";

import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";

/**
 * 成员在「移出成员」相关界面里的显示名。
 *
 * 优先级：1:1 频道的个人备注 → 群内备注 → 昵称。
 *
 * 之所以抽出来共享：列表行用的是这套解析，而批量确认弹窗一度只用
 * `subscriber.remark || subscriber.name`。两者在「我给某人设过个人备注」时会给出
 * **不同的名字** —— 一个破坏性操作的二次确认框，叫的人名和你刚勾的那一行对不上，
 * 是很容易让人误删的。
 *
 * 注意这依赖 Person channelInfo 缓存已被填充（列表挂载时对**已渲染的行**做预取），
 * 未命中时自然退化到群内备注/昵称，与预取前的表现一致。
 */
export function resolveSubscriberShowName(
  subscriber: Subscriber | null | undefined
): string {
  if (!subscriber) return "";
  const channelInfo = getCurrentImChannelInfo(
    new Channel(subscriber.uid, ChannelTypePerson)
  );
  const personalRemark = channelInfo?.orgData?.remark;
  if (typeof personalRemark === "string" && personalRemark.trim() !== "") {
    return personalRemark;
  }
  if (
    typeof subscriber.remark === "string" &&
    subscriber.remark.trim() !== ""
  ) {
    return subscriber.remark;
  }
  return subscriber.name;
}
