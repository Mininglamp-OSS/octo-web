import React, { useMemo } from "react";
import { Bot } from "lucide-react";
import { PromptForwardModal, useI18n, t, WKApp } from "@octo/base";
import {
  getMcpBotPublishPrompt,
  resolveMcpAPIBaseURL,
} from "../utils/mcpBotPublishPrompt";

interface McpBotPublishModalProps {
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

/** MCP "Bot 上架" modal — renders the generated prompt in the shared
 *  PromptForwardModal (copy / pick an owned Bot / forward the prompt into that
 *  Bot's DM). Prompt content lives in ../utils/mcpBotPublishPrompt.ts and is
 *  MCP-specific. */
export default function McpBotPublishModal({
  visible,
  mode = "create",
  editingId,
  onClose,
}: McpBotPublishModalProps) {
  useI18n();
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  // Memoize the prompt. Depend on BOTH spaceId and the configured apiURL —
  // resolveMcpAPIBaseURL derives from apiURL first and falls back to
  // window.location.origin (treated as stable), so a runtime apiURL change on
  // the mutable client config must bust the cache.
  const prompt = useMemo(
    () =>
      getMcpBotPublishPrompt({
        mode,
        pluginId: editingId,
        spaceId,
        apiBaseUrl: resolveMcpAPIBaseURL(apiURL, window.location.origin),
      }),
    [mode, editingId, spaceId, apiURL]
  );
  const isUpgrade = mode === "upgrade";

  return (
    <PromptForwardModal
      visible={visible}
      onClose={onClose}
      title={t(
        isUpgrade ? "mcp.botPublish.updateTitle" : "mcp.botPublish.title"
      )}
      hint={t(isUpgrade ? "mcp.botPublish.updateHint" : "mcp.botPublish.hint")}
      kind={isUpgrade ? "update" : "publish"}
      icon={<Bot size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
      copyTrackEvent="market_bot_publish_prompt_copied"
    />
  );
}
