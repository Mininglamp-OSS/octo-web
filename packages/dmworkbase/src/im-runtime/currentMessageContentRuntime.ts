import WKSDK from "wukongimjssdk";

import {
  isImSystemMessage,
  registerImMessageContent,
  type ImMessageContentFactory,
  type ImMessageContentRuntimeSdk,
} from "./messageContentRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImMessageContentRuntime<TContent = unknown>() {
  return currentImRuntime() as unknown as ImMessageContentRuntimeSdk<TContent>;
}

export function registerCurrentImMessageContent<TContent>(
  contentType: number,
  factory: ImMessageContentFactory<TContent>
) {
  registerImMessageContent(
    currentImMessageContentRuntime<TContent>(),
    contentType,
    factory
  );
}

export function isCurrentImSystemMessage(contentType: number) {
  // #1283 round-7 (Jerry-Xin non-blocking): SDK isSystemMessage() only accepts
  // the 1000-2000 range. Types 20 (screenshot) and 21 (summaryNotify) are
  // designed to behave as system tips (passive grey lines, no reply, no
  // forward, no notification, no unread badge) but sit outside that range.
  // Rather than duplicate the "explicitly type-21" special case at every call
  // site, layer the override at the single classifier the codebase already
  // consults — module.tsx / ConversationList / messageContinuity /
  // messageSelection all funnel through `isCurrentImSystemMessage`, so
  // this one line closes the parity gap for both types at once.
  //
  // Values kept literal to avoid a MessageContentTypeConst import into this
  // runtime helper (which lives one layer below the const module and would
  // otherwise create a circular graph). Const.ts pins these to 20/21.
  if (contentType === 20 || contentType === 21) return true;
  return isImSystemMessage(currentImMessageContentRuntime(), contentType);
}
