import React, { useEffect, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import { buildInstallPrompt, resolveAPIBaseURL } from "../utils/installPrompt";
import { Dap } from "@octo/base";

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
      // 六审 P2:写剪贴板 resolve 后才计数(原点击委托在 promise 落定前就发,权限拒绝/非安全上下文也计)。
      Dap.shared.track("market_skill_install_prompt_copied", {});
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
        <pre className="skill-market-prompt-modal__pre">{prompt}</pre>
      </div>
    </WKModal>
  );
}
