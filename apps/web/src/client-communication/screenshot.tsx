import React from "react";
import { i18n, WKApp } from "@octo/base";
import { ScreenshotToolbar } from "@octo/base/src/features/chat-composer/screenshot/ScreenshotToolbar";
import zhCN from "@octo/base/src/features/chat-composer/screenshot/i18n/zh-CN.json";
import enUS from "@octo/base/src/features/chat-composer/screenshot/i18n/en-US.json";
import type { ScreenshotHost } from "@octo/base/src/features/chat-composer/screenshot/contract";

export function installScreenshotToolbar(host: ScreenshotHost): () => void {
  if (typeof host.captureScreenshot !== "function") return () => {};
  let installed = true;
  i18n.registerNamespace("screenshot", { "zh-CN": zhCN, "en-US": enUS });
  WKApp.endpoints.registerChatToolbar("chattoolbar.screenshot", conversation => installed
    ? <ScreenshotToolbar host={host} conversation={conversation}
        scopeKey={() => `${WKApp.shared.currentSpaceId}:${WKApp.loginInfo.uid}`} />
    : undefined);
  return () => { installed = false; };
}
