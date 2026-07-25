import { parseRemoteBool } from "../Utils/remoteConfig";

/** GET /v1/common/appconfig.message_reaction 的客户端能力快照。 */
export interface MessageReactionCapability {
  read: boolean;
  write: boolean;
}

/** 契约兼容值：字段缺失或不可解析时保留展示，但不开放写入口。 */
export const DEFAULT_MESSAGE_REACTION_CAPABILITY: MessageReactionCapability = {
  read: true,
  write: false,
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function capabilityField(
  value: object,
  key: "read" | "write",
  fallback: boolean
): boolean {
  if (!hasOwn(value, key)) return fallback;
  return parseRemoteBool(Reflect.get(value, key));
}

/**
 * 对 appconfig 做字段级容错，并把非法的 read=false/write=true 收敛为完全关闭。
 * 该配置只控制客户端行为，服务端 reaction API 仍是最终权限边界。
 */
export function parseMessageReactionCapability(
  raw: unknown
): MessageReactionCapability {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MESSAGE_REACTION_CAPABILITY };
  }
  const read = capabilityField(
    raw,
    "read",
    DEFAULT_MESSAGE_REACTION_CAPABILITY.read
  );
  const write = capabilityField(
    raw,
    "write",
    DEFAULT_MESSAGE_REACTION_CAPABILITY.write
  );
  return { read, write: read && write };
}

export function messageReactionCapabilityEqual(
  left: MessageReactionCapability,
  right: MessageReactionCapability
): boolean {
  return left.read === right.read && left.write === right.write;
}
