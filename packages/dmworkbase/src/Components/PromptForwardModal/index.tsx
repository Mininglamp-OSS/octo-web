import React from "react";
import PromptForwardActions from "../PromptForwardActions";
import { t } from "../../i18n";
import "./index.css";
import { Modal as OctoModal } from "@octo/ui";

export interface PromptForwardModalProps {
  visible: boolean;
  /** Header heading. Falls back to the unified "添加给 Bot" when omitted, so the
   *  two "add" surfaces (skill 添加 / connector 接入) can stay on the default
   *  while publish/update surfaces render their own copy. */
  title?: React.ReactNode;
  /** Optional sub-line under the heading. Rendered only when provided (the
   *  default "add" surfaces have none). */
  hint?: React.ReactNode;
  /** Which action this surface performs — selects the forward-button label so a
   *  publish/update surface does not read "…进行安装". Defaults to "install". */
  kind?: "install" | "publish" | "update";
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
 * renders this and supplies the generated prompt + icon. The heading falls back
 * to the unified "添加给 Bot" for the "add" surfaces; publish/update surfaces pass
 * their own title/hint and a `kind` that relabels the forward button so the copy
 * matches the action instead of always saying "…进行安装".
 */
export default function PromptForwardModal({
  visible,
  title,
  hint,
  kind = "install",
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
        <h2>{title ?? t("base.promptForward.title")}</h2>
        {hint && <p>{hint}</p>}
      </div>
    </div>
  );

  return (
    <OctoModal
      visible={visible}
      onCancel={onClose}
      title={null}
      width="min(920px, calc(100vw - 96px))"
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
          kind={kind}
          copyTrackEvent={copyTrackEvent}
          prerequisiteHint={prerequisiteHint}
          onForwarded={onForwarded ?? onClose}
        />
      </div>
    </OctoModal>
  );
}
