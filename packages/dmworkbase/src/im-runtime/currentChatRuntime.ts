import WKSDK from "wukongimjssdk";

import {
  addImCommandListener,
  addImMessageListener,
  removeImCommandListener,
  type ImChatListener,
  type ImChatRuntimeSdk,
} from "./chatRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImChatRuntime<TMessage>() {
  return currentImRuntime() as unknown as ImChatRuntimeSdk<TMessage>;
}

export function addCurrentImCommandListener<TMessage>(
  listener: ImChatListener<TMessage>
) {
  addImCommandListener(currentImChatRuntime<TMessage>(), listener);
}

export function addCurrentImMessageListener<TMessage>(
  listener: ImChatListener<TMessage>
) {
  addImMessageListener(currentImChatRuntime<TMessage>(), listener);
}

export function removeCurrentImCommandListener<TMessage>(
  listener: ImChatListener<TMessage>
) {
  removeImCommandListener(currentImChatRuntime<TMessage>(), listener);
}
