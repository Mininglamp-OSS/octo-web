import React from "react";
import { Terminal } from "lucide-react";
import { PromptForwardModal, t, useI18n, WKApp } from "@octo/base";
import { buildInstallPrompt, resolveAPIBaseURL } from "../utils/installPrompt";

interface InstallPromptModalProps {
  skillId: string | null;
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

/**
 * "添加" a skill to a Bot: builds the install prompt and hands it to the shared
 * PromptForwardModal — the unified forward-to-Bot flow (copy / pick an owned Bot
 * / forward the prompt into that Bot's conversation) used across the markets
 * (mirrors ExpertBotPublishModal / McpBotPublishModal).
 */
export default function InstallPromptModal({ skillId, onClose }: InstallPromptModalProps) {
  useI18n();
  // Resolve the space id with the same localStorage fallback the rest of the
  // package uses (skillApiReal.getAuthHeaders / BotPublishModal): reading
  // WKApp.shared.currentSpaceId alone yields an empty prompt + broken forward in
  // sessions where the id lives only in localStorage.
  const spaceId = getCurrentSpaceId();
  const apiBaseURL = resolveAPIBaseURL(
    WKApp.apiClient.config.apiURL,
    window.location.origin
  );
  const prompt = skillId && spaceId ? buildInstallPrompt(skillId, spaceId, apiBaseURL) : "";

  return (
    <PromptForwardModal
      visible={Boolean(skillId)}
      onClose={onClose}
      title={t("skillMarket.install.title")}
      hint={t("skillMarket.install.hint")}
      icon={<Terminal size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
    />
  );
}
