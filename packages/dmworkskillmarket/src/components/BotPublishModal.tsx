import React, { useEffect, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
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

export default function BotPublishModal({
  visible,
  onClose,
}: BotPublishModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const prompt = getBotPublishPrompt({
    spaceId: getCurrentSpaceId(),
    apiBaseUrl: resolveAPIBaseURL(
      WKApp.apiClient.config.apiURL,
      window.location.origin
    ),
  });

  useEffect(() => {
    if (visible) setCopied(false);
  }, [visible]);

  function handleCopy() {
    if (!prompt || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      size="lg"
      header={
        <div className="skill-market-prompt-modal__header">
          <div className="skill-market-prompt-modal__icon">
            <Bot size={18} />
          </div>
          <div>
            <h3>{t("skillMarket.botPublish.title")}</h3>
            <p>{t("skillMarket.botPublish.hint")}</p>
          </div>
        </div>
      }
      footer={
        <WKButton
          variant="primary"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
          disabled={!prompt}
        >
          {copied
            ? t("skillMarket.botPublish.copied")
            : t("skillMarket.botPublish.copyBtn")}
        </WKButton>
      }
    >
      <div className="skill-market-prompt-modal__body">
        <pre className="skill-market-prompt-modal__pre">{prompt}</pre>
      </div>
    </WKModal>
  );
}
