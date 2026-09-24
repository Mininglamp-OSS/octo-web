import { MemberSelectionEvidence } from "../../bridge/channelSetting/memberRemovalRead";
import { t } from "../../i18n";

/** Reports current membership, not an invented count of DELETE side effects. */
export function describeMemberRemovalOutcome(
  evidence: MemberSelectionEvidence,
  total: number,
  requestError?: string
) {
  if (total > 0 && evidence.absent.length === total) {
    return { complete: true, message: t("base.subscribers.removalVerified") };
  }
  if (evidence.unknown.length) {
    const pending = t("base.subscribers.removalPending", { values: { count: evidence.unknown.length } });
    return { complete: false, message: requestError ? `${requestError} ${pending}` : pending };
  }
  if (evidence.absent.length) {
    const partial = t("base.subscribers.removalPartial", {
      values: { absent: evidence.absent.length, present: evidence.present.length },
    });
    return {
      complete: false,
      message: requestError ? `${requestError} ${partial}` : partial,
    };
  }
  return { complete: false, message: requestError || t("base.subscribers.removalStillPresent") };
}
