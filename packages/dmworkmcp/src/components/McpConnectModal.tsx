import React, { useMemo } from "react";
import { Plug } from "lucide-react";
import { PromptForwardModal, useI18n, WKApp } from "@octo/base";
import type { McpListItem } from "../types/mcp";
import {
  buildMcpConnectPrompt,
  resolveMcpAPIBaseURL,
} from "../utils/mcpConnectPrompt";

interface McpConnectModalProps {
  /** The connector to connect, or null when the modal is hidden. */
  item: McpListItem | null;
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

/** Connector "接入" modal — builds the connect prompt for a specific MCP server
 *  and hands it to the shared PromptForwardModal (copy / pick an owned Bot /
 *  forward the prompt into that Bot's conversation). Mirrors the skill card's
 *  InstallPromptModal and McpBotPublishModal — the primary card action forwards
 *  a prompt instead of opening the detail modal. */
export default function McpConnectModal({ item, onClose }: McpConnectModalProps) {
  useI18n();
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  const mcpId = item?.id ?? "";
  const prompt = useMemo(
    () =>
      mcpId
        ? buildMcpConnectPrompt({
            mcpId,
            spaceId,
            apiBaseUrl: resolveMcpAPIBaseURL(apiURL, window.location.origin),
          })
        : "",
    [mcpId, spaceId, apiURL]
  );

  return (
    <PromptForwardModal
      visible={Boolean(item)}
      onClose={onClose}
      icon={<Plug size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
      copyTrackEvent="market_mcp_connect_prompt_copied"
    />
  );
}
