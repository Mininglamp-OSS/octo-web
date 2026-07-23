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
  // Memoize the prompt — inputs are stable for the modal's lifetime and the
  // template is a few hundred bytes of string concat we'd otherwise rebuild
  // on every parent re-render (space-changed, tab switches, etc.).
  const prompt = useMemo(
    () =>
      getMcpBotPublishPrompt({
        spaceId,
        apiBaseUrl: resolveMcpAPIBaseURL(
          WKApp.apiClient.config.apiURL,
          window.location.origin
        ),
      }),
    [spaceId]
  );
  // Placeholder guard: the prompt substitutes `<space-id>` when currentSpaceId
  // is empty. Copying that would give the bot an unusable command — refuse.
  const promptReady = Boolean(prompt) && !!spaceId.trim();

  useEffect(() => {
    if (visible) setCopied(false);
  }, [visible]);

  // Clear any in-flight copy-feedback timer when the modal unmounts to avoid
  // "state update on unmounted component" warnings when the parent closes the
  // modal within 2s of a successful copy.
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
