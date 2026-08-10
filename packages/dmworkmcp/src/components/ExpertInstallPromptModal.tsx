import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";
import { buildExpertPrompt } from "../utils/buildExpertPrompt";

interface ExpertInstallPromptModalProps {
  item: ExpertItem | null;
  onClose: () => void;
  /** Copy the install prompt; returns whether the copy succeeded. */
  onCopy: (item: ExpertItem) => void | Promise<void>;
}

/**
 * Quick install-prompt popup opened from a squad card's 安装 action. Shows the
 * same copyable install prompt as the detail modal's prompt panel, but on its
 * own so users can grab it in one click without opening the full detail view.
 */
export default function ExpertInstallPromptModal({
  item,
  onClose,
  onCopy,
}: ExpertInstallPromptModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (item) setCopied(false);
  }, [item?.id]);

  const prompt = useMemo(() => (item ? buildExpertPrompt(item) : ""), [item]);

  if (!item) return null;

  const handleCopy = async () => {
    await onCopy(item);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <WKModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={t("mcp.expert.installPromptTitle")}
      width="min(680px, calc(100vw - 32px))"
    >
      <div className="wk-mcp-expert-prompt wk-mcp-expert-prompt--standalone">
        <div className="wk-mcp-expert-prompt__header">
          <p>{t("mcp.expert.installPromptHint")}</p>
        </div>
        <pre className="wk-mcp-expert-prompt__preview">{prompt}</pre>
        <div className="wk-mcp-expert-prompt__footer">
          <WKButton
            variant="primary"
            className="wk-mcp-expert-prompt__copy"
            icon={copied ? <Check size={15} /> : <Copy size={15} />}
            onClick={handleCopy}
          >
            {copied ? t("mcp.expert.copied") : t("mcp.expert.copyPrompt")}
          </WKButton>
        </div>
      </div>
    </WKModal>
  );
}
