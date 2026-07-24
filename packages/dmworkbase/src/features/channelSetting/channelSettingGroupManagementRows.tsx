import { Toast } from "@douyinfe/semi-ui";
import React from "react";
import { Subscriber } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import ChannelWebhookPanel from "../../Components/ChannelWebhook";
import { GroupManagement } from "../../Components/GroupManagement";
import { GroupMdEditor } from "../../Components/GroupMdEditor";
import { SubscriberList } from "../../Components/Subscribers/list";
import { wkConfirm } from "../../Components/WKModal";
import { GroupRole } from "../../Service/Const";
import RouteContext, {
  FinishButtonContext,
  RouteContextConfig,
} from "../../Service/Context";
import { Row } from "../../Service/Section";
import {
  remarkChannelSetting,
  transferChannelSettingOwner,
} from "../../bridge/channelSetting/channelSettingActions";
import { I18nText, t } from "../../i18n";
import { ChannelSettingInfoRow } from "../../ui/ChannelSettingRows";
import { ChannelSettingInputEditPush } from "./types";
import { createChannelSettingMemberSearch } from "./channelSettingMemberSearch";

interface BuildGroupManagementRowsOptions {
  context: RouteContext<ChannelSettingRouteData>;
  data: ChannelSettingRouteData;
  inputEditPush: ChannelSettingInputEditPush;
  disbanded: boolean;
}

function buildTransferOwnerRow(
  context: RouteContext<ChannelSettingRouteData>,
  data: ChannelSettingRouteData
): Row | undefined {
  if (data.subscriberOfMe?.role !== GroupRole.owner) return undefined;

  const { channel } = data;
  const canTransferTo = (subscriber: Subscriber) =>
    subscriber.uid !== WKApp.loginInfo.uid &&
    (subscriber.orgData?.robot === 1) !== true;
  const localSearch = createChannelSettingMemberSearch(
    data.subscribers,
    canTransferTo
  );
  let finishContext: FinishButtonContext;
  let selectedItems: Subscriber[] = [];
  return new Row({
    cell: ChannelSettingInfoRow,
    properties: {
      title: t("base.module.channelSettings.transferOwner"),
      onClick: () => {
        context.push(
          <SubscriberList
            channel={channel}
            localSearch={localSearch}
            canSelect
            singleSelect
            disableSelectList={[WKApp.loginInfo.uid || ""]}
            filter={canTransferTo}
            onSelect={(items) => {
              selectedItems = items;
              finishContext?.disable(items.length !== 1);
            }}
          />,
          new RouteContextConfig({
            title: t("base.module.channelSettings.transferOwnerSelect"),
            showFinishButton: true,
            finishButtonTitle: t("base.common.ok"),
            onFinishContext: (value) => {
              finishContext = value;
              finishContext.disable(true);
            },
            onFinish: () => {
              const selected = selectedItems[0];
              if (!selected) {
                Toast.warning(
                  t("base.module.channelSettings.transferOwnerSelectOne")
                );
                return;
              }
              const name = selected.remark || selected.name || selected.uid;
              wkConfirm({
                title: t("base.module.channelSettings.transferOwner"),
                content: t("base.module.channelSettings.transferOwnerConfirm", {
                  values: { name },
                }),
                okText: t("base.common.ok"),
                cancelText: t("base.common.cancel"),
                onOk: async () => {
                  try {
                    await transferChannelSettingOwner({
                      channel,
                      uid: selected.uid,
                    });
                    Toast.success(
                      t("base.module.channelSettings.transferOwnerSuccess")
                    );
                    context.pop();
                    data.refresh();
                  } catch (error: any) {
                    Toast.error(
                      error?.msg ||
                        t("base.module.channelSettings.transferOwnerFailed")
                    );
                    throw error;
                  }
                },
              });
            },
          })
        );
      },
    },
  });
}

export function buildGroupManagementRows({
  context,
  data,
  inputEditPush,
  disbanded,
}: BuildGroupManagementRowsOptions): Row[] {
  const { channel, channelInfo } = data;
  const rows: Row[] = [];

  if (!disbanded) {
    const transferOwnerRow = buildTransferOwnerRow(context, data);
    if (transferOwnerRow) rows.push(transferOwnerRow);

    const hasGroupMd = channelInfo?.orgData?.has_group_md;
    const mdVersion = channelInfo?.orgData?.group_md_version || 0;
    rows.push(
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: "GROUP.md",
          value: hasGroupMd
            ? t("base.module.channelSettings.configuredVersion", {
                values: { version: mdVersion },
              })
            : t("base.module.channelSettings.notConfigured"),
          onClick: () => {
            const latest = context.routeData() as ChannelSettingRouteData;
            const me = latest.subscriberOfMe;
            const canEdit =
              !!latest.channelInfo?.orgData?.can_edit_group_md ||
              me?.role === GroupRole.owner ||
              me?.role === GroupRole.manager;
            context.push(
              <GroupMdEditor channel={channel} canEdit={canEdit} />,
              new RouteContextConfig({ title: "GROUP.md" })
            );
          },
        },
      }),
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: t("base.module.channelSettings.incomingWebhook"),
          onClick: () => {
            const latest = context.routeData() as ChannelSettingRouteData;
            const isManager =
              latest.subscriberOfMe?.role === GroupRole.owner ||
              latest.subscriberOfMe?.role === GroupRole.manager;
            context.push(
              <ChannelWebhookPanel channel={channel} isManager={isManager} />,
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

    if (
      data.subscriberOfMe?.role === GroupRole.owner ||
      data.subscriberOfMe?.role === GroupRole.manager
    ) {
      rows.push(
        new Row({
          cell: ChannelSettingInfoRow,
          properties: {
            title: t("base.module.channelSettings.groupManagement"),
            onClick: () => {
              const latest = context.routeData() as ChannelSettingRouteData;
              context.push(
                <GroupManagement
                  channel={channel}
                  isCreator={latest.subscriberOfMe?.role === GroupRole.owner}
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
      cell: ChannelSettingInfoRow,
      properties: {
        title: t("base.module.channelSettings.remark"),
        value: channelInfo?.orgData?.remark,
        onClick: () => {
          inputEditPush(
            context,
            channelInfo?.orgData?.remark || "",
            (value) =>
              remarkChannelSetting({ channel, remark: value })
                .then(() => data.refresh())
                .catch((error) => {
                  Toast.error(error?.msg);
                  throw error;
                }),
            t("base.module.channelSettings.remarkPlaceholder"),
            15,
            true
          );
        },
      },
    })
  );

  return rows;
}
