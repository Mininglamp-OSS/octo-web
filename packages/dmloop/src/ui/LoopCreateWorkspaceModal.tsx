import React from "react";
import { Modal } from "@douyinfe/semi-ui";

export interface LoopCreateWorkspaceModalLabels {
  title: string;
  create: string;
  cancel: string;
  name: string;
  slug: string;
  namePlaceholder: string;
  slugPlaceholder: string;
}

export interface LoopCreateWorkspaceModalProps {
  visible: boolean;
  busy: boolean;
  name: string;
  slug: string;
  labels: LoopCreateWorkspaceModalLabels;
  onSubmit: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSlugChange: (slug: string) => void;
}

export default function LoopCreateWorkspaceModal({
  visible,
  busy,
  name,
  slug,
  labels,
  onSubmit,
  onCancel,
  onNameChange,
  onSlugChange,
}: LoopCreateWorkspaceModalProps) {
  return (
    <Modal
      className="loop-modal"
      title={labels.title}
      visible={visible}
      onOk={onSubmit}
      onCancel={onCancel}
      okText={labels.create}
      cancelText={labels.cancel}
      okButtonProps={{ loading: busy }}
    >
      <div className="loop-fields">
        <div className="loop-fields__row">
          <div className="loop-fields__label">{labels.name}</div>
          <input
            autoFocus
            className="loop-field"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={labels.namePlaceholder}
          />
        </div>
        <div className="loop-fields__row">
          <div className="loop-fields__label">{labels.slug}</div>
          <input
            className="loop-field"
            value={slug}
            onChange={(event) => onSlugChange(event.target.value)}
            placeholder={labels.slugPlaceholder}
          />
        </div>
      </div>
    </Modal>
  );
}
