/**
 * InteractiveCard (ContentType=17) wire schema 与 Adaptive Cards octo 子集类型。
 *
 * 权威来源：octo-server `pkg/cardmsg/*` + 其 `*_test.go`（`docs/card-protocol.md` 为镜像）。
 * 与 type=7 名片（Card）无任何关系。
 *
 * octo/v1（展示型）：5 类元素 + Action.OpenUrl + selectAction(仅含 OpenUrl)。
 * octo/v2（交互型，波 2）：追加 Input.Text/Toggle/ChoiceSet + Action.Submit（含 selectAction 携带），
 *   Input.* / Action.Submit 的 id 必填且帧内唯一。
 * 未知元素/动作、未知 profile/version、损坏 payload 一律整卡降级为 plain。
 * Action.Execute / ShowCard / ToggleVisibility / 模板绑定 永不支持（P3 再议）。
 */

/** 消息信封字段名（与服务端契约对齐；未知顶层字段必须容忍）。 */
export const CARD_PROFILE_OCTO_V1 = "octo/v1";
export const CARD_PROFILE_OCTO_V2 = "octo/v2";
export const CARD_VERSION_1_5 = "1.5";

/**
 * 客户端支持的 profile 集合（协商用）。
 * octo/v2 与 v1 共享 card_version 上限（<=1.5）；差异在元素/动作白名单（见 ACRenderer allowInteractive）。
 */
export const SUPPORTED_PROFILES: ReadonlySet<string> = new Set([
  CARD_PROFILE_OCTO_V1,
  CARD_PROFILE_OCTO_V2,
]);

/** 客户端支持的最高 card_version。 */
export const MAX_CARD_VERSION = CARD_VERSION_1_5;

/** 客户端防御上限（与服务端 enforced 上限对齐，信任服务端仍二次防御）。 */
export const MAX_DEPTH = 16;
export const MAX_NODES = 200;

/**
 * 消息信封。`card` 保持 `Record<string, unknown>`（未解析的 AC 树），
 * 渲染时由 ACRenderer 逐节点守卫收窄；不在解码层强解，避免早失败。
 */
export interface InteractiveCardPayload {
  type: 17;
  card: Record<string, unknown>;
  plain: string;
  card_version: string;
  profile: string;
  /** P2 tolerant-only，波 1 不实现任何行为。 */
  card_seq?: number;
  /** P2 tolerant-only，波 1 不实现任何行为。 */
  transient?: boolean;
}

/** octo/v1 支持的元素 type 字符串。 */
export const AC_ELEMENT_TYPES = {
  textBlock: "TextBlock",
  image: "Image",
  container: "Container",
  columnSet: "ColumnSet",
  column: "Column",
  factSet: "FactSet",
  /** octo/v2 交互输入元素（id 必填且帧内唯一，仅 allowInteractive 时渲染）。 */
  inputText: "Input.Text",
  inputToggle: "Input.Toggle",
  inputChoiceSet: "Input.ChoiceSet",
} as const;

/** octo 支持的动作 type 字符串。 */
export const AC_ACTION_TYPES = {
  openUrl: "Action.OpenUrl",
  /** octo/v2 提交动作（仅 allowInteractive 时接受）。Action.Execute 永不支持。 */
  submit: "Action.Submit",
} as const;
