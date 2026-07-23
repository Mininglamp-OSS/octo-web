import { Tag, Toast } from "@douyinfe/semi-ui";
import React from "react";

import WKApp from "../../App";
import { ChannelAvatar } from "../../Components/ChannelAvatar";
import ChannelQRCode from "../../Components/ChannelQRCode";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { ChannelField } from "../../Service/DataSource/DataSource";
import { GROUP_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row } from "../../Service/Section";
import { updateChannelSettingField } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import {
  ChannelSettingIconRow,
  ChannelSettingInfoRow,
} from "../../ui/ChannelSettingRows";
import { ChannelSettingInputEditPush } from "./types";

interface BuildGroupProfileRowsOptions {
  context: RouteContext<ChannelSettingRouteData>;
  data: ChannelSettingRouteData;
  inputEditPush: ChannelSettingInputEditPush;
  disbanded: boolean;
}

export function buildGroupProfileRows({
  context,
  data,
  inputEditPush,
  disbanded,
}: BuildGroupProfileRowsOptions): Row[] {
  if (disbanded) return [];

  const { channel, channelInfo } = data;
  const isExternalGroup = channelInfo?.orgData?.is_external_group === 1;
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
      cell: ChannelSettingInfoRow,
      properties: {
        title: t("base.module.channelSettings.groupName"),
        value: groupName,
        onClick: () => {
          if (!data.isManagerOrCreatorOfMe) {
            Toast.warning(
              t("base.module.channelSettings.groupNameOnlyManager")
            );
            return;
          }
          inputEditPush(
            context,
            channelInfo?.title || "",
            (value) =>
              updateChannelSettingField({
                channel,
                field: ChannelField.channelName,
                value,
              }).catch((error) => {
                Toast.error(error.msg);
              }),
            t("base.module.channelSettings.groupNamePlaceholder"),
            GROUP_NAME_MAX_LENGTH
          );
        },
      },
    }),
    new Row({
      cell: ChannelSettingIconRow,
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
        onClick: () => {
          context.push(
            <ChannelAvatar
              showUpload={data.isManagerOrCreatorOfMe}
              channel={channel}
            />,
            { title: t("base.module.channelSettings.groupAvatar") }
          );
        },
      },
    }),
    new Row({
      cell: ChannelSettingIconRow,
      properties: {
        title: t("base.module.channelSettings.groupQrCode"),
        icon: (
          <img
            style={{ width: "24px", height: "24px" }}
            src={require("../../assets/icon_qrcode.png")}
            alt=""
          />
        ),
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
      cell: ChannelSettingInfoRow,
      properties: {
        title: t("base.module.channelSettings.groupNotice"),
        value: channelInfo?.orgData?.notice,
        multiline: true,
        onClick: () => {
          if (!data.isManagerOrCreatorOfMe) {
            Toast.warning(
              t("base.module.channelSettings.groupNoticeOnlyManager")
            );
            return;
          }
          inputEditPush(
            context,
            channelInfo?.orgData?.notice || "",
            (value) =>
              updateChannelSettingField({
                channel,
                field: ChannelField.notice,
                value,
              }).catch((error) => {
                Toast.error(error.msg);
              }),
            t("base.module.channelSettings.groupNotice"),
            400,
            true,
            true
          );
        },
      },
    }),
  ];
}
