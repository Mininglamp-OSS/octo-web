import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { Toast } from "@douyinfe/semi-ui";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import {
  getMcpBotPublishPrompt,
  resolveMcpAPIBaseURL,
} from "../utils/mcpBotPublishPrompt";

interface McpBotPublishModalProps {
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

/** MCP "Bot 上架" modal — mirrors dmworkskillmarket's BotPublishModal.
 *  Renders a copy-to-clipboard prompt the user hands to an Agent. Prompt
 *  content lives in ../utils/mcpBotPublishPrompt.ts and is MCP-specific. */
export default function McpBotPublishModal({
  visible,
  onClose,
}: McpBotPublishModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  // Memoize the prompt. Depend on BOTH spaceId and the configured apiURL —
  // resolveMcpAPIBaseURL derives from apiURL first and falls back to
  // window.location.origin, so a runtime apiURL change (unusual, but the
  // client config is a mutable object) must bust the cache. window.origin
  // is treated as stable-for-session and intentionally omitted.
  const prompt = useMemo(
    () =>
      getMcpBotPublishPrompt({
        spaceId,
        apiBaseUrl: resolveMcpAPIBaseURL(apiURL, window.location.origin),
      }),
    [spaceId, apiURL]
  );
  // Copy is safe even when spaceId isn't a UUID — sanitizeSpaceId in
  // mcpBotPublishPrompt.ts already replaces non-UUID input with the
  // `<space-id>` placeholder before it reaches the shell command example.
  // Gate only on the prompt being non-empty, matching dmworkskillmarket's
  // BotPublishModal.
  const promptReady = Boolean(prompt);

  // Clear the "copied" flag AND cancel any pending 2s reset timer whenever
  // the modal transitions to hidden. Guarantees a fresh state on next open
  // and stops a timer from firing setCopied(false) on a hidden-but-mounted
  // component (harmless, but a lint- and audit-friendly cleanup).
  useEffect(() => {
    if (!visible) {
      setCopied(false);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    }
  }, [visible]);

  // Also clear the timer on unmount — covers the parent unmounting the
  // whole modal within 2s of a successful copy (the visible=false effect
  // above covers the mounted-but-hidden path).
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  async function handleCopy() {
    if (!promptReady) return;
    if (!navigator.clipboard?.writeText) {
      Toast.error(t("mcp.botPublish.copyUnavailable"));
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Reset the "copied" indicator on failure — otherwise a prior success
      // would leave the checkmark showing after a subsequent failed attempt.
      setCopied(false);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      Toast.error(t("mcp.botPublish.copyFailed"));
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      size="lg"
      className="wk-mcp-prompt-modal"
      header={
        <div className="wk-mcp-prompt-modal__header">
          <div className="wk-mcp-prompt-modal__icon">
            <Bot size={18} />
          </div>
          <div>
            <h3>{t("mcp.botPublish.title")}</h3>
            <p>{t("mcp.botPublish.hint")}</p>
          </div>
        </div>
      }
      footer={
        <WKButton
          variant="primary"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
          disabled={!promptReady}
        >
          {copied
            ? t("mcp.botPublish.copied")
            : t("mcp.botPublish.copyBtn")}
        </WKButton>
      }
    >
      <div className="wk-mcp-prompt-modal__body">
        <pre className="wk-mcp-prompt-modal__pre">{prompt}</pre>
      </div>
    </WKModal>
  );
}
