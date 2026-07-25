import WKApp from "../App";
import { DEFAULT_MESSAGE_REACTION_CAPABILITY } from "./MessageReactionConfig";

function messageReactionCapability() {
  return (
    WKApp.remoteConfig.messageReaction ?? DEFAULT_MESSAGE_REACTION_CAPABILITY
  );
}

/** 是否解析并展示消息 Reaction。 */
export function canReadMessageReaction(): boolean {
  return messageReactionCapability().read;
}

/** 是否展示写入口并允许客户端发起增删请求。write 永远依赖 read。 */
export function canWriteMessageReaction(): boolean {
  const capability = messageReactionCapability();
  return capability.read && capability.write;
}
