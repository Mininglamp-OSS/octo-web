import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Check, Copy, Terminal } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import { buildInstallPrompt, resolveAPIBaseURL } from "../utils/installPrompt";

interface InstallPromptModalProps {
  skillId: string | null;
  onClose: () => void;
}

export default function InstallPromptModal({ skillId, onClose }: InstallPromptModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (skillId) setCopied(false);
  }, [skillId]);

  const spaceId = WKApp.shared.currentSpaceId;
  const apiBaseURL = resolveAPIBaseURL(WKApp.apiClient.config.apiURL, window.location.origin);
  const prompt = skillId && spaceId ? buildInstallPrompt(skillId, spaceId, apiBaseURL) : "";

  function handleCopy() {
    if (!prompt || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <WKModal
      visible={Boolean(skillId)}
      onCancel={onClose}
      title={null}
      size="lg"
      header={
        <div className="skill-market-prompt-modal__header">
          <div className="skill-market-prompt-modal__icon">
            <Terminal size={18} />
          </div>
          <div>
            <h3>{t("skillMarket.install.title")}</h3>
            <p>{t("skillMarket.install.hint")}</p>
          </div>
        </div>
      }
      footer={
        <WKButton
          variant="primary"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
        >
          {copied ? t("skillMarket.install.copied") : t("skillMarket.install.copyBtn")}
        </WKButton>
      }
    >
      <div className="skill-market-prompt-modal__body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {prompt}
        </ReactMarkdown>
      </div>
    </WKModal>
  );
}
