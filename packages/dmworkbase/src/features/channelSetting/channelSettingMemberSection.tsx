import { Subscriber } from "wukongimjssdk";
import React from "react";
import { Toast } from "@douyinfe/semi-ui";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { Subscribers } from "../../Components/Subscribers";
import { MemberRemovalList } from "../../Components/Subscribers/memberRemovalList";
import { wkConfirm } from "../../Components/WKModal/confirm";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
  GroupRole,
} from "../../Service/Const";
import RouteContext, {
  FinishButtonContext,
  RouteContextConfig,
} from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import { removeChannelSettingSubscribers } from "../../bridge/channelSetting/channelSettingActions";
import WKApp from "../../App";

// 判定逻辑住在零依赖的叶子模块里，好让 Components/Subscribers/vm.ts 也能复用
// （直接互相 import 会成环）。此处 re-export 保持既有引用路径不变。
import {
  canRemoveChannelSettingSubscriber,
  isBotOwnedByViewer,
} from "./memberRemovalPermission";
export { canRemoveChannelSettingSubscriber, isBotOwnedByViewer };

export function buildChannelMembersSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;

  if (
    channel.channelType === ChannelTypeCustomerService ||
    channel.channelType === ChannelTypeCommunityTopic
  ) {
    return undefined;
  }

  if (isGroupDisbanded(data.channelInfo)) {
    return undefined;
  }

  const viewAllRemoveAction = {
    canRemove: (subscriber: Subscriber) => {
      const viewerRole = data.subscriberOfMe?.role ?? GroupRole.normal;
      if (viewerRole !== GroupRole.normal) return false;
      return canRemoveChannelSettingSubscriber({
        viewerUid: data.subscriberOfMe?.uid || WKApp.loginInfo.uid,
        viewerRole,
        subscriber,
      });
    },
    onRemove: (subscriber: Subscriber) =>
      removeChannelSettingSubscribers({
        channel,
        uids: [subscriber.uid],
      }),
  };

  // 「移出成员」是一条**独立**路径：减号图标 → MemberRemovalList。
  //
  // 群主和管理员从减号进入独立批量页；「查看全部」只保留普通成员移除
  // 自己 Bot 的行级兜底，避免超大群中 Bot 不在本地缓存时入口完全不可达。
  return new Section({
    rows: [
      new Row({
        cell: Subscribers,
        properties: {
          context,
          channel,
          key: channel.getChannelKey(),
          canManageBotAdmin: !!data.channelInfo?.orgData?.can_manage_bot_admin,
          removeAction: viewAllRemoveAction,
          onRemove: () => {
            // subscriberOfMe may be populated after this section is built.
            const viewerUid = data.subscriberOfMe?.uid || WKApp.loginInfo.uid;
            const viewerRole = data.subscriberOfMe?.role;
            // 「确认」按钮属于**路由表头**（RouteContextConfig.showFinishButton），
            // 不属于列表组件；所以批量提交的编排放在这里，组件只负责上报选择。
            // 这与「转让群主」（channelSettingGroupManagementRows）是同一套模式，不另造。
            let finishContext: FinishButtonContext | undefined;
            let selected: Subscriber[] = [];
            let confirming = false;
            let submitting = false;

            const syncFinishDisabled = () => {
              finishContext?.disable(submitting || selected.length === 0);
            };

            context.push(
              <MemberRemovalList
                channel={channel}
                initialSubscribers={data.subscribers}
                viewerUid={viewerUid}
                viewerRole={viewerRole}
                onSelectionChange={(items) => {
                  selected = items;
                  syncFinishDisabled();
                }}
              />,
              new RouteContextConfig({
                // 纯文案标题：不挂 organizationalTool，「移出成员」页右上角不再有
                // 「添加成员」。也刻意不带成员计数 —— 本页按 canRemove 过滤，
                // 管理员看到的人数会少于群总人数，带计数会让用户拿它跟群人数对账。
                title: t("base.subscribers.removeMemberTitle"),
                showFinishButton: true,
                finishButtonTitle: t("base.common.ok"),
                finishButtonClassName: "wk-memberremoval-finish-btn",
                onFinishContext: (value) => {
                  finishContext = value;
                  // 进页时未选任何人，「确认」必须是置灰的。
                  finishContext.disable(true);
                },
                onFinish: () => {
                  if (confirming || submitting) return;
                  if (selected.length === 0) {
                    Toast.warning(t("base.subscribers.removeSelectAtLeastOne"));
                    return;
                  }
                  const count = selected.length;
                  const uids = selected.map((item) => item.uid);
                  confirming = true;
                  wkConfirm({
                    title: t("base.subscribers.removeMemberTitle"),
                    content: t("base.subscribers.confirmRemoveBatchContent", {
                      values: { count },
                    }),
                    okText: t("base.subscribers.remove"),
                    okType: "danger",
                    onCancel: () => {
                      confirming = false;
                    },
                    onOk: async () => {
                      if (submitting) return;
                      submitting = true;
                      syncFinishDisabled();
                      finishContext?.loading(true);
                      try {
                        // **一次**请求提交整批。后端 memberRemove 的自助分支做的是
                        // 整批校验（任一目标不在白名单即整批拒绝，不做部分执行），
                        // 逐个调用反而会把一个天然批量的接口拆散用。
                        await removeChannelSettingSubscribers({
                          channel,
                          uids,
                        });
                        // 管理员接口只返回成功/失败，不返回实际移除集合；避免在
                        // 并发离群等场景里展示服务端未确认的精确人数。
                        Toast.success(t("base.subscribers.removeSuccess"));
                        context.pop();
                        data.refresh?.();
                      } catch (error: any) {
                        // 批量是全成全败，所以只报一次错并**保留页面与勾选态**
                        // 让用户重试，不能 pop（那会像部分成功）。
                        Toast.error(
                          error?.msg || t("base.subscribers.removeFailed")
                        );
                        throw error;
                      } finally {
                        submitting = false;
                        confirming = false;
                        finishContext?.loading(false);
                        syncFinishDisabled();
                      }
                    },
                  });
                },
              })
            );
          },
        },
      }),
    ],
  });
}
