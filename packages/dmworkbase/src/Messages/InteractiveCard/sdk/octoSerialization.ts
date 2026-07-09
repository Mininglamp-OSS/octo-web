import {
  CardObjectRegistry,
  GlobalRegistry,
  SerializationContext,
  Versions,
  type Action,
  type CardElement,
} from "adaptivecards";

/**
 * octo 的 SDK 反序列化上下文。
 *
 * 白名单主权威在 `validateCardForOcto`（元素/结构/URL/预算/D1，fail-closed 整卡降级），
 * SDK 只会收到已通过校验的卡。这里对 SDK 注册表再做一层**防御纵深**（validate 若有疏漏时的兜底）：
 *
 * - **动作**是有副作用的（触发 host 回调），移除 `Action.Execute`/`ShowCard`/`ToggleVisibility`，
 *   只留 octo 的 `Action.OpenUrl` + `Action.Submit`。
 * - **元素**移除非 octo 白名单类型（Carousel/Media），
 *   只留 octo 允许的类型。即便 validate 疏漏，这些元素也无法被 SDK 反序列化。
 *
 * 采用「populate 默认后 unregister 非白名单」而非 register-only：octo 允许的元素保持默认注册，
 * 避免漏注册导致合法卡半渲染；新版 AC 引入的未知元素虽不在此剔除列表，仍由 validate 整卡拦下。
 */
const FORBIDDEN_ACTIONS = [
  "Action.Execute",
  "Action.ShowCard",
  "Action.ToggleVisibility",
] as const;

/** 非 octo 白名单元素（AC 默认注册但 octo 不支持）。octo manifest 允许：
 *  TextBlock/RichTextBlock/Image/ImageSet/Container/ColumnSet/FactSet/Table/ActionSet
 *  + 6 类输入 Input.Text/Toggle/ChoiceSet/Number/Date/Time。
 *  TextRun 是 RichTextBlock.inlines 的 inline 节点，需保留。 */
const FORBIDDEN_ELEMENTS = ["Carousel", "Media"] as const;

export function createOctoSerializationContext(): SerializationContext {
  // 受限 context 也要显式使用 SDK 上限版本；否则默认目标版本可能过低，
  // RichTextBlock/TextRun(v1.2+) 或 Table(v1.5) 会因版本门槛无法实例化。
  const ctx = new SerializationContext(Versions.latest);

  const actionRegistry = new CardObjectRegistry<Action>();
  GlobalRegistry.populateWithDefaultActions(actionRegistry);
  for (const type of FORBIDDEN_ACTIONS) {
    actionRegistry.unregister(type);
  }
  ctx.setActionRegistry(actionRegistry);

  const elementRegistry = new CardObjectRegistry<CardElement>();
  GlobalRegistry.populateWithDefaultElements(elementRegistry);
  for (const type of FORBIDDEN_ELEMENTS) {
    elementRegistry.unregister(type);
  }
  ctx.setElementRegistry(elementRegistry);

  return ctx;
}

export default createOctoSerializationContext;
