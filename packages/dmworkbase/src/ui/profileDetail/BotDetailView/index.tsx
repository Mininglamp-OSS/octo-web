import React from "react";
import { Button, Input, Spin } from "@douyinfe/semi-ui";
import {
  IconAlertCircle,
  IconCamera,
  IconChevronRight,
  IconEdit,
  IconTickCircle,
} from "@douyinfe/semi-icons";
import AiBadge from "../../../Components/AiBadge";
import WKButton from "../../../Components/WKButton";
import VoiceInputButton, {
  type ReplaceMode,
  type SelectionRange,
} from "../../../Components/VoiceInputButton";
import ProfileDetailShell, {
  ProfileDetailFooter,
  ProfileDetailHeader,
} from "../ProfileDetailShell";
import "./index.css";

export interface BotDetailViewCommand {
  cmd: string;
  remark: string;
}

export interface BotDetailViewLabels {
  close: string;
  changeAvatar: string;
  reported: string;
  notReported: string;
  reportHelp: string;
  help: string;
  remark: string;
  noRemark: string;
  remarkPlaceholder: string;
  editRemark: string;
  nickname: string;
  description: string;
  editDescription: string;
  edit: string;
  descriptionPlaceholder: string;
  noDescription: string;
  creator: string;
  commands: string;
  botManageTitle: string;
  viewClawInfo: string;
  sendMessage: string;
  addFriend: string;
  applyMessageLabel: string;
  applyMessagePlaceholder: string;
  applySend: string;
  save: string;
  cancel: string;
}

export interface BotDetailViewProps {
  loading: boolean;
  displayName: string;
  botName: string;
  username: string;
  remark: string;
  displayDescription: string;
  creatorName: string;
  commands: BotDetailViewCommand[];
  isOwner: boolean;
  isFriend: boolean;
  reported: boolean | null;
  uploadingAvatar: boolean;
  editingRemark: boolean;
  remarkDraft: string;
  savingRemark: boolean;
  editingDescription: boolean;
  descriptionDraft: string;
  savingDescription: boolean;
  showApplyInput: boolean;
  applyRemark: string;
  applying: boolean;
  ownerAvatar: React.ReactNode;
  previewAvatar: React.ReactNode;
  fileInputRef: React.Ref<HTMLInputElement>;
  descriptionRef: React.RefObject<HTMLTextAreaElement>;
  labels: BotDetailViewLabels;
  onClose: () => void;
  onAvatarClick: () => void;
  onAvatarKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onAvatarInputClick: (event: React.MouseEvent<HTMLInputElement>) => void;
  onAvatarFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemarkDraftChange: (value: string) => void;
  onStartEditRemark: () => void;
  onEditRemarkKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => void;
  onCancelEditRemark: () => void;
  onSaveRemark: () => void;
  onStartEditDescription: () => void;
  onEditDescriptionKeyDown: (
    event: React.KeyboardEvent<HTMLSpanElement>
  ) => void;
  onDescriptionDraftChange: (value: string) => void;
  onDescriptionTranscribed: (
    text: string,
    mode: ReplaceMode,
    savedRange?: SelectionRange
  ) => void;
  getCurrentDescriptionText: () => string;
  onCancelEditDescription: () => void;
  onSaveDescription: () => void;
  onOpenBotManage: (event?: React.MouseEvent) => void;
  onViewClawInfo: () => void;
  onChat: () => void;
  onShowApply: () => void;
  onApplyRemarkChange: (value: string) => void;
  onSubmitApply: () => void;
}

export function BotDetailView({
  loading,
  displayName,
  botName,
  username,
  remark,
  displayDescription,
  creatorName,
  commands,
  isOwner,
  isFriend,
  reported,
  uploadingAvatar,
  editingRemark,
  remarkDraft,
  savingRemark,
  editingDescription,
  descriptionDraft,
  savingDescription,
  showApplyInput,
  applyRemark,
  applying,
  ownerAvatar,
  previewAvatar,
  fileInputRef,
  descriptionRef,
  labels,
  onClose,
  onAvatarClick,
  onAvatarKeyDown,
  onAvatarInputClick,
  onAvatarFileChange,
  onRemarkDraftChange,
  onStartEditRemark,
  onEditRemarkKeyDown,
  onCancelEditRemark,
  onSaveRemark,
  onStartEditDescription,
  onEditDescriptionKeyDown,
  onDescriptionDraftChange,
  onDescriptionTranscribed,
  getCurrentDescriptionText,
  onCancelEditDescription,
  onSaveDescription,
  onOpenBotManage,
  onViewClawInfo,
  onChat,
  onShowApply,
  onApplyRemarkChange,
  onSubmitApply,
}: BotDetailViewProps) {
  return (
    <ProfileDetailShell
      className="wk-bot-detail-content"
      contentClassName="wk-bot-detail-scroll"
      loadingClassName="wk-bot-detail-loading"
      loading={loading}
      loadingNode={<Spin size="large" />}
      closeLabel={labels.close}
      onClose={onClose}
      footer={
        <ProfileDetailFooter
          className="wk-bot-detail-footer"
          actionClassName="wk-bot-detail-actions"
          action={
            isFriend ? (
              <WKButton
                className="wk-bot-detail-primary-action"
                type="button"
                variant="primary"
                onClick={onChat}
              >
                {labels.sendMessage}
              </WKButton>
            ) : showApplyInput ? (
              <div className="wk-bot-detail-apply">
                <div className="wk-bot-detail-apply-label">
                  {labels.applyMessageLabel}
                </div>
                <Input
                  value={applyRemark}
                  onChange={onApplyRemarkChange}
                  placeholder={labels.applyMessagePlaceholder}
                />
                <WKButton
                  className="wk-bot-detail-primary-action"
                  type="button"
                  variant="primary"
                  loading={applying}
                  disabled={!applyRemark}
                  onClick={onSubmitApply}
                >
                  {labels.applySend}
                </WKButton>
              </div>
            ) : (
              <WKButton
                className="wk-bot-detail-primary-action"
                type="button"
                variant="primary"
                onClick={onShowApply}
              >
                {labels.addFriend}
              </WKButton>
            )
          }
        />
      }
    >
      <ProfileDetailHeader
        className="wk-bot-detail-header"
        avatarClassName="wk-bot-detail-header-avatar"
        titleClassName="wk-bot-detail-name"
        subtitleClassName="wk-profile-detail-subtitle--mono wk-bot-detail-id"
        avatar={
          isOwner ? (
            <div
              className="wk-bot-detail-avatar wk-bot-detail-avatar--owner"
              onClick={onAvatarClick}
              onKeyDown={onAvatarKeyDown}
              role="button"
              tabIndex={0}
              aria-label={labels.changeAvatar}
            >
              {ownerAvatar}
              <div className="wk-bot-detail-avatar-overlay" aria-hidden="true">
                <IconCamera />
              </div>
              {uploadingAvatar && (
                <div className="wk-bot-detail-avatar-loading">
                  <Spin />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple={false}
                className="wk-bot-detail-file-input"
                onClick={onAvatarInputClick}
                onChange={onAvatarFileChange}
              />
            </div>
          ) : (
            <div className="wk-bot-detail-avatar wk-bot-detail-avatar--preview">
              {previewAvatar}
            </div>
          )
        }
        title={displayName}
        badges={<AiBadge />}
        subtitle={`@${username}`}
        status={
          isOwner && reported !== null ? (
            <div
              className={`wk-bot-detail-octopush-chip ${
                reported
                  ? "wk-bot-detail-octopush-chip--reported"
                  : "wk-bot-detail-octopush-chip--unmanaged"
              }`}
            >
              <span className="wk-bot-detail-octopush-status">
                <span className="wk-bot-detail-octopush-chip-icon">
                  {reported ? <IconTickCircle /> : <IconAlertCircle />}
                </span>
                <span className="wk-bot-detail-octopush-chip-text">
                  {reported ? labels.reported : labels.notReported}
                </span>
                {!reported && (
                  <button
                    type="button"
                    className="wk-bot-detail-help-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    title={labels.reportHelp}
                    aria-label={labels.help}
                  >
                    ?
                  </button>
                )}
              </span>
            </div>
          ) : undefined
        }
      />

      <div className="wk-bot-detail-section">
        <div className="wk-bot-detail-row wk-bot-detail-row--editable">
          <div className="wk-bot-detail-row-main">
            <div className="wk-bot-detail-label">{labels.remark}</div>
            {editingRemark ? (
              <div className="wk-bot-detail-editor">
                <Input
                  value={remarkDraft}
                  onChange={onRemarkDraftChange}
                  placeholder={labels.remarkPlaceholder}
                  maxLength={30}
                />
                <div className="wk-bot-detail-editor-actions">
                  <Button
                    size="small"
                    onClick={onCancelEditRemark}
                    disabled={savingRemark}
                  >
                    {labels.cancel}
                  </Button>
                  <Button
                    size="small"
                    theme="solid"
                    type="primary"
                    loading={savingRemark}
                    onClick={onSaveRemark}
                  >
                    {labels.save}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="wk-bot-detail-value">
                {remark || (
                  <span className="wk-bot-detail-empty">{labels.noRemark}</span>
                )}
              </div>
            )}
          </div>
          {!editingRemark && (
            <Button
              className="wk-bot-detail-value-edit"
              theme="borderless"
              type="tertiary"
              size="small"
              icon={<IconEdit />}
              onClick={onStartEditRemark}
              onKeyDown={onEditRemarkKeyDown}
              aria-label={labels.editRemark}
              title={labels.editRemark}
            />
          )}
        </div>
        {remark && (
          <div className="wk-bot-detail-row">
            <div className="wk-bot-detail-label">{labels.nickname}</div>
            <div className="wk-bot-detail-value wk-bot-detail-value--right">
              {botName}
            </div>
          </div>
        )}
      </div>

      <div className="wk-bot-detail-section">
        <div className="wk-bot-detail-description">
          <div className="wk-bot-detail-field-header">
            <div className="wk-bot-detail-label">{labels.description}</div>
            {isOwner && !editingDescription && (
              <Button
                className="wk-bot-detail-edit-action"
                theme="borderless"
                type="tertiary"
                size="small"
                icon={<IconEdit />}
                onClick={onStartEditDescription}
                onKeyDown={onEditDescriptionKeyDown}
                aria-label={labels.editDescription}
              >
                {labels.edit}
              </Button>
            )}
          </div>
          {isOwner && editingDescription ? (
            <div>
              <div className="wk-bot-detail-textarea-wrap">
                <textarea
                  ref={descriptionRef}
                  className="wk-bot-detail-textarea"
                  value={descriptionDraft}
                  onChange={(e) => onDescriptionDraftChange(e.target.value)}
                  placeholder={labels.descriptionPlaceholder}
                  maxLength={200}
                  rows={3}
                />
                <VoiceInputButton
                  inputRef={descriptionRef}
                  onTranscribed={onDescriptionTranscribed}
                  getCurrentText={getCurrentDescriptionText}
                  showModeMenu
                  size="sm"
                  className="wk-vib--textarea-corner"
                />
              </div>
              <div className="wk-bot-detail-editor-actions">
                <Button
                  size="small"
                  onClick={onCancelEditDescription}
                  disabled={savingDescription}
                >
                  {labels.cancel}
                </Button>
                <Button
                  size="small"
                  theme="solid"
                  type="primary"
                  loading={savingDescription}
                  onClick={onSaveDescription}
                >
                  {labels.save}
                </Button>
              </div>
            </div>
          ) : (
            <div className="wk-bot-detail-description-text">
              {displayDescription}
            </div>
          )}
        </div>
      </div>

      {(creatorName || commands.length > 0) && (
        <div className="wk-bot-detail-section">
          {creatorName && (
            <div className="wk-bot-detail-row">
              <div className="wk-bot-detail-label">{labels.creator}</div>
              <div className="wk-bot-detail-value wk-bot-detail-value--right">
                {creatorName}
              </div>
            </div>
          )}
          {commands.length > 0 && (
            <div className="wk-bot-detail-command-block">
              <div className="wk-bot-detail-label">{labels.commands}</div>
              <div className="wk-bot-detail-command-list">
                {commands.map((cmd, i) => (
                  <div key={i} className="wk-bot-detail-cmd">
                    <span className="wk-bot-detail-cmd-name">{cmd.cmd}</span>
                    <span className="wk-bot-detail-cmd-desc">{cmd.remark}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <div className="wk-bot-detail-section">
          <button
            type="button"
            onClick={onOpenBotManage}
            className="wk-bot-detail-nav-row"
            aria-label={labels.botManageTitle}
          >
            <span>{labels.botManageTitle}</span>
            <IconChevronRight className="wk-bot-detail-nav-chevron" />
          </button>
          {reported !== null && (
            <button
              type="button"
              onClick={onViewClawInfo}
              className={`wk-bot-detail-nav-row${
                !reported ? " wk-bot-detail-nav-row--disabled" : ""
              }`}
              disabled={!reported}
              aria-label={labels.viewClawInfo}
              title={!reported ? labels.reportHelp : undefined}
            >
              <span className="wk-bot-detail-nav-main">
                <span
                  className="wk-bot-detail-claw-action-icon"
                  aria-hidden="true"
                >
                  🦞
                </span>
                <span>{labels.viewClawInfo}</span>
              </span>
              {reported && (
                <IconChevronRight className="wk-bot-detail-nav-chevron" />
              )}
            </button>
          )}
        </div>
      )}
    </ProfileDetailShell>
  );
}

export default BotDetailView;
