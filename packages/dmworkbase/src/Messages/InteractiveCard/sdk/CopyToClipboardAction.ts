import { Action, type SerializationContext } from "adaptivecards";

/**
 * octo 本地动作：复制一段显式声明的文本到剪贴板。
 *
 * Adaptive Cards 标准没有 Copy 动作；这里仅负责让 SDK 渲染按钮并把 action
 * 透传到 Cell。副作用、toast、fallback 都在宿主层处理。
 */
export class CopyToClipboardAction extends Action {
  static readonly JsonTypeName = "Action.CopyToClipboard";

  text = "";

  getJsonTypeName(): string {
    return CopyToClipboardAction.JsonTypeName;
  }

  parse(source: any, context?: SerializationContext): void {
    super.parse(source, context);
    this.text = typeof source?.text === "string" ? source.text : "";
  }
}

export default CopyToClipboardAction;
