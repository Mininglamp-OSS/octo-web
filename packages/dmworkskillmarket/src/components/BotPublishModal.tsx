import React, { useMemo } from "react";
import { Bot } from "lucide-react";
import { PromptForwardModal, t, useI18n, WKApp } from "@octo/base";
import { resolveAPIBaseURL } from "../utils/installPrompt";
import { getBotPublishPrompt } from "../utils/botPublishPrompt";

interface BotPublishModalProps {
  visible: boolean;
  onClose: () => void;
}

function getCurrentSpaceId(): string {
  return (
    WKApp.shared?.currentSpaceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("currentSpaceId") || ""
      : "")
  );
}

/** Skill "Bot 上架" modal — renders the generated publish prompt in the shared
 *  PromptForwardModal (copy / pick an owned Bot / forward the prompt into that
 *  Bot's DM), matching the MCP 上架 and connector/skill 添加到 Bot surfaces.
 *  Prompt content lives in ../utils/botPublishPrompt.ts. */
export default function BotPublishModal({
  visible,
  onClose,
}: BotPublishModalProps) {
  useI18n();
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  // Depend on BOTH spaceId and the configured apiURL — resolveAPIBaseURL derives
  // from apiURL first and falls back to window.location.origin, so a runtime
  // apiURL change on the mutable client config must bust the cache.
  const prompt = useMemo(
    () =>
      getBotPublishPrompt({
        spaceId,
        apiBaseUrl: resolveAPIBaseURL(apiURL, window.location.origin),
      }),
    [spaceId, apiURL]
  );

  return (
    <PromptForwardModal
      visible={visible}
      onClose={onClose}
      title={t("skillMarket.botPublish.title")}
      hint={t("skillMarket.botPublish.hint")}
      icon={<Bot size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
    />
  );
}
