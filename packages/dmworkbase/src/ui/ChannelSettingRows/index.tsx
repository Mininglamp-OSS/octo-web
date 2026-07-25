import React from "react";

import {
  ListItem,
  ListItemButton,
  ListItemButtonType,
  ListItemIcon,
  ListItemMuliteLine,
  ListItemSwitch,
  ListItemSwitchContext,
} from "../../Components/ListItem";

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
