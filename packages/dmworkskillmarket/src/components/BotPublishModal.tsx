import React, { useMemo } from "react";
import { Bot } from "lucide-react";
import { PromptForwardModal, t, useI18n, WKApp } from "@octo/base";
import { resolveAPIBaseURL } from "../utils/installPrompt";
import { getBotPublishPrompt } from "../utils/botPublishPrompt";

interface BotPublishModalProps {
  visible: boolean;
  mode?: "create" | "upgrade";
  editingId?: string;
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
  mode = "create",
  editingId,
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
        mode,
        pluginId: editingId,
        spaceId,
        apiBaseUrl: resolveAPIBaseURL(apiURL, window.location.origin),
      }),
    [mode, editingId, spaceId, apiURL]
  );
  const isUpgrade = mode === "upgrade";

  return (
    <PromptForwardModal
      visible={visible}
      onClose={onClose}
      title={t(
        isUpgrade
          ? "skillMarket.botPublish.updateTitle"
          : "skillMarket.botPublish.title"
      )}
      hint={t(
        isUpgrade
          ? "skillMarket.botPublish.updateHint"
          : "skillMarket.botPublish.hint"
      )}
      kind={isUpgrade ? "update" : "publish"}
      icon={<Bot size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
      copyTrackEvent="market_bot_publish_prompt_copied"
    />
  );
}
