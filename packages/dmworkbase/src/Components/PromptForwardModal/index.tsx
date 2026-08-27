import React from "react";
import PromptForwardActions from "../PromptForwardActions";
import "./index.css";
import { Modal as OctoModal } from "@octo/ui";

export interface PromptForwardModalProps {
  visible: boolean;
  /** Modal title (left of the header). */
  title: React.ReactNode;
  /** Optional sub-line under the title. */
  hint?: React.ReactNode;
  /** Optional leading icon rendered in the header. */
  icon?: React.ReactNode;
  /** The generated prompt shown on the left and handed to the Bot. */
  prompt: string;
  /** Space to fetch owned Bots from / stamp on the forwarded DM. */
  spaceId?: string;
  /** Optional prerequisite hint rendered above the forward button. */
  prerequisiteHint?: string;
  onClose: () => void;
  /** Called after a successful forward; defaults to onClose. */
  onForwarded?: () => void;
}

/**
 * Shared "hand this prompt to a Bot" modal — the single owner of the split
 * layout (prompt + 复制 on the left, 选 Bot + 转发 on the right). Every
 * marketplace prompt surface (安装 / 上架专家 / 上架专家团 / MCP 上架 / 编辑)
 * renders this and only supplies the generated prompt + header text, so the
 * layout is changed in one place. Built on the shared PromptForwardActions
 * (layout="split") from @octo/base.
 */
export default function PromptForwardModal({
  visible,
  title,
  hint,
  icon,
  prompt,
  spaceId,
  prerequisiteHint,
  onClose,
  onForwarded,
}: PromptForwardModalProps) {
  const header = (
    <div className="wk-prompt-forward-modal__header">
      {icon && (
        <span className="wk-prompt-forward-modal__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="wk-prompt-forward-modal__heading">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
    </div>
  );

  return (
    <OctoModal
      visible={visible}
      onCancel={onClose}
      title={null}
      width="min(920px, calc(100vw - 32px))"
      className="wk-prompt-forward-modal"
      footer={null}
      header={header}
    >
      <div className="wk-prompt-forward-modal__box">
        <PromptForwardActions
          layout="split"
          preview={
            // tabIndex: the scrollbar is styled away, so keyboard users need
            // the <pre> focusable to scroll a long generated prompt (a plain
            // pre is not in the tab order).
            <pre className="wk-prompt-forward__preview-pre" tabIndex={0}>
              {prompt}
            </pre>
          }
          prompt={prompt}
          spaceId={spaceId}
          disabled={!prompt}
          prerequisiteHint={prerequisiteHint}
          onForwarded={onForwarded ?? onClose}
        />
      </div>
    </OctoModal>
  );
}
