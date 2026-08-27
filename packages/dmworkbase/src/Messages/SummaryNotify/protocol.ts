export const SUMMARY_TIP_TEMPLATE = "{0}总结了群聊内容";

interface SummaryTipExtra {
  uid: string;
  name: string;
}

export interface SummaryTipPayload {
  content: typeof SUMMARY_TIP_TEMPLATE;
  extra: [SummaryTipExtra];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSummaryTipPayload(
  uid: string,
  name: string
): SummaryTipPayload {
  return {
    content: SUMMARY_TIP_TEMPLATE,
    extra: [{ uid, name }],
  };
}

/** Identifies only this feature's WK_TIP payload, not every generic type-2000 tip. */
export function isSummaryTipContent(value: unknown): boolean {
  const payload =
    isRecord(value) && isRecord(value.content) ? value.content : value;
  if (!isRecord(payload) || payload.content !== SUMMARY_TIP_TEMPLATE) {
    return false;
  }
  if (!Array.isArray(payload.extra) || payload.extra.length !== 1) {
    return false;
  }
  const sender = payload.extra[0];
  return (
    isRecord(sender) &&
    typeof sender.uid === "string" &&
    typeof sender.name === "string"
  );
}
