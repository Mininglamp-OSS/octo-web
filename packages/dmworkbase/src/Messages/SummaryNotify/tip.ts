import { SystemContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { createSummaryTipPayload } from "./protocol";
import type { SummaryTipPayload } from "./protocol";

export * from "./protocol";

/**
 * Send-side WK_TIP (2000) content for group-summary completion.
 *
 * Extending SystemContent is important: the SDK keeps this exact instance for
 * the sender's local echo, while SystemCell reads `displayText`. Initializing
 * `content` gives the local echo the same placeholder rendering contract as a
 * remote message decoded by the SDK.
 */
export class SummaryTipContent extends SystemContent {
  declare content: SummaryTipPayload;

  constructor() {
    super();
    this.content = createSummaryTipPayload("", "");
  }

  setSender(uid: string, name: string): this {
    this.content = createSummaryTipPayload(
      typeof uid === "string" ? uid.trim() : "",
      typeof name === "string" ? name.trim() : ""
    );
    return this;
  }

  encodeJSON(): SummaryTipPayload {
    return this.content;
  }

  get contentType() {
    return MessageContentTypeConst.summaryTip;
  }
}
