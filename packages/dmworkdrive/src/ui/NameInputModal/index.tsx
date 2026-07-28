import React, { useState, useEffect } from 'react';
import { useI18n } from '@octo/base';
import { Modal, Input } from '@douyinfe/semi-ui';

export interface NameInputModalProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  /** Pre-filled value (e.g. current name for rename). */
  initialValue?: string;
  okText?: string;
  /** Return true to close the modal (caller has already run the mutation). */
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Single-text-field modal reused for new-folder / rename / create-shared-space.
 * All three are "type a name, confirm" — one component keeps them consistent.
 */
export default function NameInputModal({
  visible,
  title,
  placeholder,
  initialValue = '',
  okText,
  onSubmit,
  onClose,
}: NameInputModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const handleOk = async () => {
    const name = value.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    const ok = await onSubmit(name);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={title}
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText={okText ?? t('drive.common.confirm')}
      cancelText={t('drive.common.cancel')}
      okButtonProps={{ disabled: !value.trim() }}
      maskClosable={false}
    >
      <Input
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        autoFocus
        maxLength={255}
        onEnterPress={handleOk}
      />
    </Modal>
  );
}
