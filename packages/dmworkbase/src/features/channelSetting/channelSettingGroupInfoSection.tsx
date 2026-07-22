import { Toast, Tag } from "@douyinfe/semi-ui";
import React from "react";
import { ChannelTypeGroup, Subscriber } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelAvatar } from "../../Components/ChannelAvatar";
import ChannelQRCode from "../../Components/ChannelQRCode";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import ChannelWebhookPanel from "../../Components/ChannelWebhook";
import { GroupManagement } from "../../Components/GroupManagement";
import { GroupMdEditor } from "../../Components/GroupMdEditor";
import {
  ListItem,
  ListItemIcon,
  ListItemMuliteLine,
} from "../../Components/ListItem";
import { SubscriberList } from "../../Components/Subscribers/list";
import { wkConfirm } from "../../Components/WKModal";
import { GroupRole } from "../../Service/Const";
import RouteContext, {
  FinishButtonContext,
  RouteContextConfig,
} from "../../Service/Context";
import { ChannelField } from "../../Service/DataSource/DataSource";
import { GROUP_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { I18nText, t } from "../../i18n";
import {
  remarkChannelSetting,
  transferChannelSettingOwner,
  updateChannelSettingField,
} from "../../bridge/channelSetting/channelSettingActions";
import { ChannelSettingInputEditPush } from "./channelSettingSections";

export function buildChannelGroupInfoSection(
  context: RouteContext<ChannelSettingRouteData>,
  inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channelInfo = data.channelInfo;
  const channel = data.channel;
  if (channel.channelType !== ChannelTypeGroup) {
    return undefined;
  }

  const rows = new Array<Row>();
  const disbanded = isGroupDisbanded(channelInfo);
  const isExternalGroup = channelInfo?.orgData?.is_external_group === 1;
  const groupNameSubTitle = isExternalGroup ? (
    <span>
      {channelInfo?.title}
      <Tag color="orange" size="small" style={{ marginLeft: 6 }}>
        {t("base.module.channelSettings.externalGroup")}
      </Tag>
    </span>
  ) : (
    channelInfo?.title
  );

  if (!disbanded) {
    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.channelSettings.groupName"),
          subTitle: groupNameSubTitle,
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
              (value: string) => {
                return updateChannelSettingField({
                  channel,
                  field: ChannelField.channelName,
                  value,
                }).catch((err) => {
                  Toast.error(err.msg);
                });
              },
              t("base.module.channelSettings.groupNamePlaceholder"),
              GROUP_NAME_MAX_LENGTH
            );
          },
        },
      })
    );

    rows.push(
      new Row({
        cell: ListItemIcon,
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
      })
    );

    rows.push(
      new Row({
        cell: ListItemIcon,
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
      })
    );

    rows.push(
      new Row({
        cell: ListItemMuliteLine,
        properties: {
          title: t("base.module.channelSettings.groupNotice"),
          subTitle: channelInfo?.orgData?.notice,
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
              (value: string) => {
                return updateChannelSettingField({
                  channel,
                  field: ChannelField.notice,
                  value,
                }).catch((err) => {
                  Toast.error(err.msg);
                });
              },
              t("base.module.channelSettings.groupNotice"),
              400,
              true,
              true
            );
          },
        },
      })
    );
  }

  if (!disbanded && data.subscriberOfMe?.role === GroupRole.owner) {
    let transferOwnerFinishButtonContext: FinishButtonContext;
    let transferOwnerSelectedItems: Subscriber[] = [];
    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.channelSettings.transferOwner"),
          onClick: () => {
            context.push(
              <SubscriberList
                channel={channel}
                canSelect={true}
                singleSelect={true}
                disableSelectList={[WKApp.loginInfo.uid || ""]}
                filter={(subscriber) =>
                  subscriber.uid !== WKApp.loginInfo.uid &&
                  (subscriber.orgData?.robot === 1) !== true
                }
                onSelect={(items) => {
                  transferOwnerSelectedItems = items;
                  transferOwnerFinishButtonContext?.disable(items.length !== 1);
                }}
              />,
              new RouteContextConfig({
                title: t("base.module.channelSettings.transferOwnerSelect"),
                showFinishButton: true,
                finishButtonTitle: t("base.common.ok"),
                onFinishContext: (finishButtonContext) => {
                  transferOwnerFinishButtonContext = finishButtonContext;
                  transferOwnerFinishButtonContext.disable(true);
                },
                onFinish: () => {
                  const selected = transferOwnerSelectedItems[0];
                  if (!selected) {
                    Toast.warning(
                      t("base.module.channelSettings.transferOwnerSelectOne")
                    );
                    return;
                  }
                  const name = selected.remark || selected.name || selected.uid;
                  wkConfirm({
                    title: t("base.module.channelSettings.transferOwner"),
                    content: t(
                      "base.module.channelSettings.transferOwnerConfirm",
                      { values: { name } }
                    ),
                    okText: t("base.common.ok"),
                    cancelText: t("base.common.cancel"),
                    onOk: async () => {
                      try {
                        await transferChannelSettingOwner({
                          channel,
                          uid: selected.uid,
                        });
                        Toast.success(
                          t(
                            "base.module.channelSettings.transferOwnerSuccess"
                          )
                        );
                        context.pop();
                        data.refresh();
                      } catch (err: any) {
                        Toast.error(
                          err?.msg ||
                            t(
                              "base.module.channelSettings.transferOwnerFailed"
                            )
                        );
                        throw err;
                      }
                    },
                  });
                },
              })
            );
          },
        },
      })
    );
  }

  if (!disbanded) {
    const hasGroupMd = channelInfo?.orgData?.has_group_md;
    const mdVersion = channelInfo?.orgData?.group_md_version || 0;
    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: "GROUP.md",
          subTitle: hasGroupMd
            ? t("base.module.channelSettings.configuredVersion", {
                values: { version: mdVersion },
              })
            : t("base.module.channelSettings.notConfigured"),
          onClick: () => {
            const latestData = context.routeData() as ChannelSettingRouteData;
            const subscriberOfMe = latestData?.subscriberOfMe;
            const isOwnerOrManager =
              subscriberOfMe &&
              (subscriberOfMe.role === 1 || subscriberOfMe.role === 2);
            const canEditMd =
              !!latestData?.channelInfo?.orgData?.can_edit_group_md ||
              isOwnerOrManager;
            context.push(
              <GroupMdEditor channel={channel} canEdit={canEditMd} />,
              new RouteContextConfig({
                title: "GROUP.md",
              })
            );
          },
        },
      })
    );

    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.channelSettings.incomingWebhook"),
          onClick: () => {
            const rd = context.routeData() as ChannelSettingRouteData;
            const me = rd?.subscriberOfMe;
            const isManager =
              me?.role === GroupRole.owner || me?.role === GroupRole.manager;
            context.push(
              <ChannelWebhookPanel
                channel={channel}
                isManager={!!isManager}
              />,
              new RouteContextConfig({
                title: (
                  <I18nText k="base.module.channelSettings.incomingWebhook" />
                ),
              })
            );
          },
        },
      })
    );

    const latestData = context.routeData() as ChannelSettingRouteData;
    const subscriberOfMe = latestData?.subscriberOfMe;
    if (
      subscriberOfMe &&
      (subscriberOfMe.role === GroupRole.owner ||
        subscriberOfMe.role === GroupRole.manager)
    ) {
      rows.push(
        new Row({
          cell: ListItem,
          properties: {
            title: t("base.module.channelSettings.groupManagement"),
            onClick: () => {
              const rd = context.routeData() as ChannelSettingRouteData;
              const me = rd?.subscriberOfMe;
              const isCreator = me?.role === GroupRole.owner;
              context.push(
                <GroupManagement
                  channel={channel}
                  isCreator={isCreator}
                  context={context}
                />,
                new RouteContextConfig({
                  title: t("base.module.channelSettings.groupManagement"),
                })
              );
            },
          },
        })
      );
    }
  }

  rows.push(
    new Row({
      cell: ListItem,
      properties: {
        title: t("base.module.channelSettings.remark"),
        subTitle: channelInfo?.orgData?.remark,
        onClick: () => {
          inputEditPush(
            context,
            channelInfo?.orgData?.remark || "",
            (value: string) => {
              return remarkChannelSetting({ channel, remark: value })
                .then(() => {
                  data.refresh();
                })
                .catch((err) => {
                  Toast.error(err?.msg);
                  throw err;
                });
            },
            t("base.module.channelSettings.remarkPlaceholder"),
            15,
            true
          );
        },
      },
    })
  );

  return new Section({
    rows,
  });
}
