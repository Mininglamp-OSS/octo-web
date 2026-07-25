import type { MessageReaction } from "./MessageReactionService";

declare module "wukongimjssdk" {
  interface Message {
    /** Octo 服务端 `reactions[]` 明细；与 SDK 自带的聚合 `reactions` 字段分开。 */
    octoReactions?: MessageReaction[];
  }
}
