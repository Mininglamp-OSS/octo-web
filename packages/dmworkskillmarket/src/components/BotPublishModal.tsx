import { Button } from "@octo/ui";
import React, { useEffect, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { t, useI18n, WKApp, WKModal, Dap } from "@octo/base";
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
      // 八审 P2:改为复制成功后命令式 track。此前挂 TrackRules 点击委托(skill-bot-publish-copy),
      // 会在 clipboard.writeText 落定前就发,且非安全上下文(navigator.clipboard 缺失)提前 return 时
      // 什么都没复制却仍计一次(与六审已修的三条 *_copied 同源)。
      Dap.shared.track("market_bot_publish_prompt_copied", {});
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
        <Button
          variant="solid"
          data-testid="skill-bot-publish-copy"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
          disabled={!prompt}
        >
          {copied
            ? t("skillMarket.botPublish.copied")
            : t("skillMarket.botPublish.copyBtn")}
        </Button>
      }
    >
      <div className="skill-market-prompt-modal__body">
        <pre className="skill-market-prompt-modal__pre">{prompt}</pre>
      </div>
    </WKModal>
  );
}
