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
  return isImSystemMessage(currentImMessageContentRuntime(), contentType);
}
