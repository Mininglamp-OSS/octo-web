import { Tag, Toast } from "@douyinfe/semi-ui";
import { QrCode } from "lucide-react";
import React from "react";

import WKApp from "../../App";
import { ChannelAvatar } from "../../Components/ChannelAvatar";
import ChannelQRCode from "../../Components/ChannelQRCode";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { GroupRole } from "../../Service/Const";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { ChannelField } from "../../Service/DataSource/DataSource";
import { GROUP_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row } from "../../Service/Section";
import { updateChannelSettingField } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import {
  ChannelSettingIconRow,
  ChannelSettingIconRowProps,
  ChannelSettingInlineEditRow,
} from "../../ui/ChannelSettingRows";
import { parseAvatarColorIndex } from "./channelSettingAvatarColor";
import { ChannelSettingInputEditPush } from "./types";

interface BuildGroupProfileRowsOptions {
  context: RouteContext<ChannelSettingRouteData>;
  data: ChannelSettingRouteData;
  inputEditPush: ChannelSettingInputEditPush;
  disbanded: boolean;
}

interface GroupAvatarSettingRowProps extends ChannelSettingIconRowProps {
  channel: ChannelSettingRouteData["channel"];
  showUpload?: boolean;
  groupName?: string;
  isNamedGroup?: boolean;
  initialAvatarText?: string;
  initialColorIndex?: number;
  isUploadedAvatar?: boolean;
  canClearUploadedAvatar?: boolean;
}

function GroupAvatarSettingRow({
  channel,
  showUpload,
  groupName,
  isNamedGroup,
  initialAvatarText,
  initialColorIndex,
  isUploadedAvatar,
  canClearUploadedAvatar,
  ...rowProps
}: GroupAvatarSettingRowProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <>
      <ChannelSettingIconRow {...rowProps} onClick={() => setVisible(true)} />
      <ChannelAvatar
        visible={visible}
        onClose={() => setVisible(false)}
        showUpload={showUpload}
        channel={channel}
        groupName={groupName}
        isNamedGroup={isNamedGroup}
        initialAvatarText={initialAvatarText}
        initialColorIndex={initialColorIndex}
        isUploadedAvatar={isUploadedAvatar}
        canClearUploadedAvatar={canClearUploadedAvatar}
      />
    </>
  );
}

export function buildGroupProfileRows({
  context,
  data,
  disbanded,
}: BuildGroupProfileRowsOptions): Row[] {
  if (disbanded) return [];

  const { channel, channelInfo } = data;
  const isExternalGroup = channelInfo?.orgData?.is_external_group === 1;
  const isNamedGroup = channelInfo?.orgData?.is_named === 1;
  const isUploadedAvatar = channelInfo?.orgData?.is_upload_avatar === 1;
  const canClearUploadedAvatar = data.subscriberOfMe?.role === GroupRole.owner;
  const avatarColor = parseAvatarColorIndex(channelInfo?.orgData?.avatar_color);
  const groupName = isExternalGroup ? (
    <span>
      {channelInfo?.title}
      <Tag color="orange" size="small" style={{ marginLeft: 6 }}>
        {t("base.module.channelSettings.externalGroup")}
      </Tag>
    </span>
  ) : (
    channelInfo?.title
  );

  return [
    new Row({
      cell: ChannelSettingInlineEditRow,
      properties: {
        title: t("base.module.channelSettings.groupName"),
        value: channelInfo?.title || "",
        displayValue: groupName,
        placeholder: t("base.module.channelSettings.groupNamePlaceholder"),
        maxCount: GROUP_NAME_MAX_LENGTH,
        onStartEdit: () => {
          if (!data.isManagerOrCreatorOfMe) {
            Toast.warning(
              t("base.module.channelSettings.groupNameOnlyManager")
            );
            return false;
          }
          return true;
        },
        onSave: (value: string) =>
          updateChannelSettingField({
            channel,
            field: ChannelField.channelName,
            value,
          }).catch((error) => {
            Toast.error(error.msg);
            return false;
          }),
      },
    }),
    new Row({
      cell: GroupAvatarSettingRow,
      properties: {
        title: t("base.module.channelSettings.groupAvatar"),
        icon: (
          <img
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "var(--wk-avatar-radius, 50%)",
            }}
            src={WKApp.shared.avatarChannel(channel)}
            alt=""
          />
        ),
        showUpload: data.isManagerOrCreatorOfMe,
        channel,
        groupName: channelInfo?.title || "",
        isNamedGroup,
        initialAvatarText: channelInfo?.orgData?.avatar_text || "",
        initialColorIndex: avatarColor,
        isUploadedAvatar,
        canClearUploadedAvatar,
      },
    }),
    new Row({
      cell: ChannelSettingIconRow,
      properties: {
        title: t("base.module.channelSettings.groupQrCode"),
        icon: <QrCode className="wk-channelsetting-qrcode-icon" aria-hidden />,
        onClick: () => {
          context.push(
            <ChannelQRCode channel={channel} />,
            new RouteContextConfig({
              title: t("base.module.channelSettings.groupQrCard"),
            })
          );
        },
      },
    }),
    new Row({
      cell: ChannelSettingInlineEditRow,
      properties: {
        title: t("base.module.channelSettings.groupNotice"),
        value: channelInfo?.orgData?.notice,
        multiline: true,
        placeholder: t("base.module.channelSettings.groupNotice"),
        maxCount: 400,
        allowEmpty: true,
        onStartEdit: () => {
          if (!data.isManagerOrCreatorOfMe) {
            Toast.warning(
              t("base.module.channelSettings.groupNoticeOnlyManager")
            );
            return false;
          }
          return true;
        },
        onSave: (value: string) =>
          updateChannelSettingField({
            channel,
            field: ChannelField.notice,
            value,
          }).catch((error) => {
            Toast.error(error.msg);
            return false;
          }),
      },
    }),
  ];
}
