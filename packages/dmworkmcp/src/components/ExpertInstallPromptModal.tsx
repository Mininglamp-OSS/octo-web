import React, { useMemo } from "react";
import { PromptForwardModal, WKApp, t, useI18n } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";
import { buildExpertPrompt, resolveMcpAPIBaseURL } from "../utils/buildExpertPrompt";

interface ExpertInstallPromptModalProps {
  item: ExpertItem | null;
  onClose: () => void;
}

/** Current Space ID (marketplace side), mirroring the bot-publish modals. */
function getCurrentSpaceId(): string {
  return (
    WKApp.shared?.currentSpaceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("currentSpaceId") || ""
      : "")
  );
}

/**
 * Quick install-prompt popup opened from an expert/squad card's 安装 action.
 * The prompt (buildExpertPrompt) tells a Loop Agent to fetch this marketplace
 * item with octo-cli and recreate it in the workspace with octo-daemon; the
 * shared PromptForwardModal lets the user copy it or forward it straight to one
 * of their Bots.
 */
export default function ExpertInstallPromptModal({
  item,
  onClose,
}: ExpertInstallPromptModalProps) {
  useI18n();
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  const prompt = useMemo(
    () =>
      item
        ? buildExpertPrompt(item, {
            spaceId,
            apiBaseUrl: resolveMcpAPIBaseURL(apiURL, window.location.origin),
          })
        : "",
    [item, spaceId, apiURL]
  );

  if (!item) return null;

  return (
    <PromptForwardModal
      visible={Boolean(item)}
      onClose={onClose}
      title={t("mcp.expert.installPromptTitle")}
      hint={t("mcp.expert.installPromptHint")}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
    />
  );
}
