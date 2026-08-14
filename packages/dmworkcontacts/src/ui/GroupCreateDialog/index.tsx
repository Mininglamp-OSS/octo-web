import React, { useEffect, useState } from "react";
import { Input } from "@douyinfe/semi-ui";
import { Pencil } from "lucide-react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import { ChannelAvatar, GroupAvatarPreview, WKModal } from "@octo/base";

import GroupMemberPicker from "../GroupMemberPicker";
import type { GroupCreateDialogProps } from "./types";
import "./index.css";

const GROUP_CREATE_DRAFT_CHANNEL = new Channel(
  "group-create-avatar-draft",
  ChannelTypeGroup
);

function GroupCreateDialog({
  mode,
  isOpen,
  copy,
  form,
  memberPicker,
  actions,
}: GroupCreateDialogProps) {
  const isCreate = mode === "createGroup";
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>();

  useEffect(() => {
    if (!form.avatarFile) {
      setAvatarPreviewUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(form.avatarFile);
    setAvatarPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [form.avatarFile]);

  return (
    <>
      {isCreate ? (
        <WKModal
          size="lg"
          className="wk-main-modal-group-create"
          visible={isOpen}
          title={copy.title}
          options={{ closable: true, maskClosable: false }}
          onCancel={actions.onCancel}
          footerConfig={{
            onOk: actions.onConfirm,
            okText: copy.confirm,
            cancelText: copy.cancel,
            isOkLoading: form.isSubmitting,
          }}
        >
          <div className="group-create-body">
            <div className="group-create-field">
              <div className="group-create-label">{copy.avatarLabel}</div>
              <div className="group-create-avatar-row">
                {avatarPreviewUrl ? (
                  <img
                    className="group-create-avatar-image"
                    src={avatarPreviewUrl}
                    alt=""
                  />
                ) : (
                  <GroupAvatarPreview
                    avatarText={form.avatarText}
                    colorIndex={form.avatarColorIndex}
                    name={form.groupName}
                    size={48}
                  />
                )}
                <button
                  type="button"
                  className="group-create-edit-avatar"
                  onClick={actions.onOpenAvatarEditor}
                  disabled={form.isSubmitting}
                >
                  <Pencil
                    size={16}
                    className="group-create-edit-avatar-icon"
                    aria-hidden="true"
                  />
                  {copy.editAvatar}
                </button>
              </div>
            </div>

            <div className="group-create-field">
              <div className="group-create-label group-create-required">
                {copy.nameLabel}
              </div>
              <Input
                value={form.groupName}
                maxLength={form.maxNameLength}
                placeholder={copy.namePlaceholder}
                onChange={actions.onGroupNameChange}
                disabled={form.isSubmitting}
              />
              <div
                className={`group-create-input-count ${
                  form.groupName.length > form.maxNameLength
                    ? "group-create-input-count--exceeded"
                    : ""
                }`}
              >
                {form.groupName.length} / {form.maxNameLength}
              </div>
            </div>

            <div className="group-create-field">
              <div className="group-create-label group-create-required">
                {copy.membersLabel}
              </div>
              <div className="group-create-members">
                <GroupMemberPicker {...memberPicker} />
              </div>
            </div>
          </div>
        </WKModal>
      ) : (
        <WKModal
          size="lg"
          className="wk-main-modal-organizational-group-new"
          visible={isOpen}
          options={{ closable: false, maskClosable: false }}
          onCancel={actions.onCancel}
        >
          <GroupMemberPicker {...memberPicker} />
        </WKModal>
      )}

      {isCreate && (
        <ChannelAvatar
          channel={GROUP_CREATE_DRAFT_CHANNEL}
          showUpload
          visible={form.isAvatarEditorOpen}
          groupName={form.groupName}
          initialAvatarText={form.avatarText}
          initialColorIndex={form.avatarColorIndex}
          initialUploadFile={form.avatarFile}
          colorSeed=""
          onClose={actions.onCloseAvatarEditor}
          onDraftSave={actions.onSaveAvatar}
        />
      )}
    </>
  );
}

export default GroupCreateDialog;
export { GroupCreateDialog };
export type { GroupCreateDialogProps } from "./types";
