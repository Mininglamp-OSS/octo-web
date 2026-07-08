import {
  CardObjectRegistry,
  GlobalRegistry,
  SerializationContext,
  type Action,
} from "adaptivecards";

/**
 * octo 的 SDK 反序列化上下文。
 *
 * 白名单主权威在 `validateCardForOcto`（元素/结构/URL/预算/D1，fail-closed 整卡降级），
 * SDK 只会收到已通过校验的卡，故元素注册表用 SDK 默认即可（避免与 validate 形成双白名单漂移）。
 *
 * 这里只对**动作**做防御纵深：动作是**有副作用**的（触发 host 回调），风险面最高。
 * 移除 `Action.Execute` / `Action.ShowCard` / `Action.ToggleVisibility`，只留 octo 的
 * `Action.OpenUrl` + `Action.Submit`，即便 validate 有疏漏也不会解析出这些动作。
 */
const FORBIDDEN_ACTIONS = [
  "Action.Execute",
  "Action.ShowCard",
  "Action.ToggleVisibility",
] as const;

export function createOctoSerializationContext(): SerializationContext {
  const ctx = new SerializationContext();
  const actionRegistry = new CardObjectRegistry<Action>();
  GlobalRegistry.populateWithDefaultActions(actionRegistry);
  for (const type of FORBIDDEN_ACTIONS) {
    actionRegistry.unregister(type);
  }
  ctx.setActionRegistry(actionRegistry);
  return ctx;
}

export default createOctoSerializationContext;
