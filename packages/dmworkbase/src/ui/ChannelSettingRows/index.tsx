import { Button, Input, TextArea } from "@douyinfe/semi-ui";
import { IconClear } from "@douyinfe/semi-icons";
import React, { useEffect, useState } from "react";

import {
  ListItem,
  ListItemButton,
  ListItemButtonType,
  ListItemIcon,
  ListItemMuliteLine,
  ListItemSwitch,
  ListItemSwitchContext,
} from "../../Components/ListItem";
import { t } from "../../i18n";
import "./index.css";

export interface ChannelSettingInfoRowProps {
  title: string;
  value?: React.ReactNode;
  multiline?: boolean;
  onClick?: () => void;
}

export function ChannelSettingInfoRow({
  title,
  value,
  multiline = false,
  onClick,
}: ChannelSettingInfoRowProps) {
  const Cell = multiline ? ListItemMuliteLine : ListItem;
  return <Cell title={title} subTitle={value} onClick={onClick} style={{}} />;
}

export interface ChannelSettingIconRowProps {
  title: string;
  icon: JSX.Element;
  onClick?: () => void;
}

export function ChannelSettingIconRow({
  title,
  icon,
  onClick,
}: ChannelSettingIconRowProps) {
  return (
    <ListItemIcon title={title} icon={icon} onClick={onClick} style={{}} />
  );
}

export interface ChannelSettingToggleRowProps {
  title: string;
  checked?: boolean;
  onChange?: (checked: boolean, context?: ListItemSwitchContext) => void;
}

export function ChannelSettingToggleRow({
  title,
  checked,
  onChange,
}: ChannelSettingToggleRowProps) {
  return (
    <ListItemSwitch
      title={title}
      checked={checked}
      onCheck={onChange}
      style={{}}
    />
  );
}

export interface ChannelSettingActionRowProps {
  title: string;
  danger?: boolean;
  onClick?: () => void;
}

export function ChannelSettingActionRow({
  title,
  danger = false,
  onClick,
}: ChannelSettingActionRowProps) {
  return (
    <ListItemButton
      title={title}
      type={danger ? ListItemButtonType.warn : ListItemButtonType.default}
      onClick={onClick}
      style={{}}
    />
  );
}

export interface ChannelSettingInlineEditRowProps {
  title: string;
  value?: string;
  displayValue?: React.ReactNode;
  placeholder?: string;
  maxCount?: number;
  allowEmpty?: boolean;
  multiline?: boolean;
  onStartEdit?: () => boolean | void;
  onSave: (value: string) => Promise<void | boolean>;
}

export function ChannelSettingInlineEditRow({
  title,
  value = "",
  displayValue,
  placeholder,
  maxCount,
  allowEmpty = false,
  multiline = false,
  onStartEdit,
  onSave,
}: ChannelSettingInlineEditRowProps) {
  const [editing, setEditing] = useState(false);
  const [currentValue, setCurrentValue] = useState(value);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrentValue(value);
    setDraft(value);
  }, [value]);

  const exceeded = maxCount !== undefined && draft.length > maxCount;
  const emptyInvalid = !allowEmpty && draft.trim().length === 0;
  const unchanged = draft === currentValue;
  const saveDisabled = saving || exceeded || emptyInvalid || unchanged;

  const startEdit = () => {
    if (onStartEdit?.() === false) return;
    setDraft(currentValue);
    setEditing(true);
  };

  if (!editing) {
    return (
      <ChannelSettingInfoRow
        title={title}
        value={currentValue === value ? displayValue ?? value : currentValue}
        multiline={multiline}
        onClick={startEdit}
      />
    );
  }

  const inputProps = {
    value: draft,
    placeholder,
    disabled: saving,
    onChange: (next: string) => setDraft(next),
  };

  return (
    <div className="wk-channelsetting-inline-edit">
      <div className="wk-channelsetting-inline-edit-title">{title}</div>
      {multiline ? (
        <TextArea
          {...inputProps}
          showClear
          onClear={() => setDraft("")}
          autosize={{ minRows: 2, maxRows: 6 }}
        />
      ) : (
        <Input
          {...inputProps}
          suffix={
            draft && !saving ? (
              <button
                type="button"
                className="wk-channelsetting-inline-edit-clear"
                aria-label={`${title}-${t("base.common.clear")}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraft("");
                }}
              >
                <IconClear />
              </button>
            ) : null
          }
        />
      )}
      <div className="wk-channelsetting-inline-edit-footer">
        {maxCount !== undefined ? (
          <span
            className={`wk-channelsetting-inline-edit-count${
              exceeded ? " wk-channelsetting-inline-edit-count-error" : ""
            }`}
          >
            {draft.length} / {maxCount}
          </span>
        ) : null}
        <Button
          theme="borderless"
          disabled={saving}
          onClick={() => {
            setDraft(currentValue);
            setEditing(false);
          }}
        >
          {t("base.common.cancel")}
        </Button>
        <Button
          theme="solid"
          loading={saving}
          disabled={saveDisabled}
          onClick={async () => {
            setSaving(true);
            try {
              const saved = await onSave(draft);
              if (saved !== false) setCurrentValue(draft);
              setEditing(false);
            } catch {
              // The bridge/container owns the user-facing error message.
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("base.common.save")}
        </Button>
      </div>
    </div>
  );
}
