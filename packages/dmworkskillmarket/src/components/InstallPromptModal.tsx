import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Check, Copy, Terminal } from "lucide-react";
import { WKButton, WKModal } from "@octo/base";
import { buildInstallPrompt } from "../utils/installPrompt";

interface InstallPromptModalProps {
  skillId: string | null;
  onClose: () => void;
}

export default function InstallPromptModal({ skillId, onClose }: InstallPromptModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (skillId) setCopied(false);
  }, [skillId]);

  const prompt = skillId ? buildInstallPrompt(skillId) : "";

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
            <h3>安装 Prompt</h3>
            <p>复制后粘贴到 Agent 对话中，将自动完成安装</p>
          </div>
        </div>
      }
      footer={
        <WKButton
          variant="primary"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
        >
          {copied ? "已复制" : "复制安装 Prompt"}
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
