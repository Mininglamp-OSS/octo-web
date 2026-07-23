import React from "react";
import { Input } from "@douyinfe/semi-ui";

import { GroupAvatarEditModal, GroupAvatarPreview, WKModal } from "@octo/base";

import GroupMemberPicker from "../GroupMemberPicker";
import type { GroupCreateDialogProps } from "./types";
import "./index.css";

function GroupCreateDialog({
  mode,
  isOpen,
  copy,
  form,
  memberPicker,
  actions,
}: GroupCreateDialogProps) {
  const isCreate = mode === "createGroup";

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
          }}
        >
          <div className="group-create-body">
            <div className="group-create-field">
              <div className="group-create-label">{copy.avatarLabel}</div>
              <div className="group-create-avatar-row">
                <GroupAvatarPreview
                  avatarText={form.avatarText}
                  colorIndex={form.avatarColorIndex}
                  name={form.groupName}
                  size={48}
                />
                <span
                  className="group-create-edit-avatar"
                  onClick={actions.onOpenAvatarEditor}
                >
                  {copy.editAvatar}
                </span>
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

      <GroupAvatarEditModal
        visible={form.isAvatarEditorOpen}
        name={form.groupName}
        initialAvatarText={form.avatarText}
        initialColorIndex={form.avatarColorIndex}
        onCancel={actions.onCloseAvatarEditor}
        onSave={(result) =>
          actions.onSaveAvatar(result.avatarText, result.colorIndex)
        }
      />
    </>
  );
}

export default GroupCreateDialog;
export { GroupCreateDialog };
export type { GroupCreateDialogProps } from "./types";
