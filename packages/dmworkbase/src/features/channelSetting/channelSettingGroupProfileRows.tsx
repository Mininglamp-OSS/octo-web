import { Tag, Toast } from "@douyinfe/semi-ui";
import { QrCode } from "lucide-react";
import React from "react";

import WKApp from "../../App";
import { ChannelAvatar } from "../../Components/ChannelAvatar";
import ChannelQRCode from "../../Components/ChannelQRCode";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { ChannelField } from "../../Service/DataSource/DataSource";
import { GROUP_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row } from "../../Service/Section";
import { canRenameGroup } from "../../Service/threadPermission";
import { updateChannelSettingField } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import {
  ChannelSettingIconRow,
  ChannelSettingInlineEditRow,
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
      cell: ChannelSettingInlineEditRow,
      properties: {
        title: t("base.module.channelSettings.groupName"),
        value: channelInfo?.title || "",
        displayValue: groupName,
        placeholder: t("base.module.channelSettings.groupNamePlaceholder"),
        maxCount: GROUP_NAME_MAX_LENGTH,
        onStartEdit: () => {
          // 服务端放开后（octo-server #542）任何活跃人类成员都可改群名，
          // 前端只挡龙虾/黑名单（canRenameGroup 粗过滤），外部成员放到弹窗
          // 后由服务端裁决、经下方 Toast.error(err.msg) 呈现。走到 false 分支多为
          // 龙虾/黑名单/非成员——给中性反馈，避免「可点击但无任何反应」的 dead click。
          if (!canRenameGroup(data.subscriberOfMe)) {
            Toast.info(t("base.module.channelSettings.renameUnavailable"));
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
