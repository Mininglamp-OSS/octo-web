import React from "react";
import WKModal from "../WKModal";
import PromptForwardActions from "../PromptForwardActions";
import { t } from "../../i18n";
import "./index.css";

export interface PromptForwardModalProps {
  visible: boolean;
  /** @deprecated The header title is unified to "添加给 Bot"; this is ignored. */
  title?: React.ReactNode;
  /** @deprecated The sub-line was removed; this is ignored. */
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
  /** DAP event emitted once on a successful copy (per-surface). See
   *  PromptForwardActions.copyTrackEvent / DAP_EVENTS.md. */
  copyTrackEvent?: string;
}

/**
 * Shared "hand this prompt to a Bot" modal — the single owner of the split
 * layout (editable prompt + copy on the left, 选 Bot + 转发 on the right). Every
 * marketplace prompt surface (安装 / 上架专家 / 上架专家团 / MCP 上架 / 接入)
 * renders this and only supplies the generated prompt + icon; the header title
 * is unified to "添加给 Bot" here, so the layout and copy live in one place.
 */
export default function PromptForwardModal({
  visible,
  icon,
  prompt,
  spaceId,
  prerequisiteHint,
  onClose,
  onForwarded,
  copyTrackEvent,
}: PromptForwardModalProps) {
  const header = (
    <div className="wk-prompt-forward-modal__header">
      {icon && (
        <span className="wk-prompt-forward-modal__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="wk-prompt-forward-modal__heading">
        <h2>{t("base.promptForward.title")}</h2>
      </div>
    </div>
  );

  return (
    <WKModal
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
          prompt={prompt}
          spaceId={spaceId}
          disabled={!prompt}
          copyTrackEvent={copyTrackEvent}
          prerequisiteHint={prerequisiteHint}
          onForwarded={onForwarded ?? onClose}
        />
      </div>
    </WKModal>
  );
}
