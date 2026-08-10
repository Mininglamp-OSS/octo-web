import WKSDK from "wukongimjssdk";
import { MessageContentTypeConst } from "../Service/Const";

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
  // #1283 round-8 P1-B (@yujiawei): the SDK isSystemMessage() only accepts
  // the 1000-2000 range, so contentType 21 (summaryNotify) is not treated as
  // a system message by any callsite that funnels through this helper. Add
  // an explicit override for 21 ONLY. Type 20 (screenshot) is a shipped
  // feature whose "counts as a system message" posture is a product
  // decision — reclassifying it here would silently:
  //   1. remove its desktop notification + alert sound (privacy signal),
  //   2. hide its "Create thread" context menu entry,
  //   3. stop its lone-unread badge.
  // Any of those may be desirable but each needs product sign-off and its
  // own PR — not a side effect of adding a summary tip.
  if (contentType === MessageContentTypeConst.summaryNotify) return true;
  return isImSystemMessage(currentImMessageContentRuntime(), contentType);
}
