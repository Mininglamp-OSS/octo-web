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
} from "../../Service/Const";
import RouteContext, {
  FinishButtonContext,
  RouteContextConfig,
} from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import { removeAndReconcileChannelSettingSubscribers } from "../../bridge/channelSetting/channelSettingActions";
import { createChannelSettingMemberSearch } from "./channelSettingMemberSearch";
import { resolveSubscriberShowName } from "../../Components/Subscribers/subscriberShowName";
import WKApp from "../../App";

// 判定逻辑住在零依赖的叶子模块里，好让 Components/Subscribers/vm.ts 也能复用
// （直接互相 import 会成环）。此处 re-export 保持既有引用路径不变。
export {
  canRemoveChannelSettingSubscriber,
  isBotOwnedByViewer,
} from "./memberRemovalPermission";

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

  // 「移出成员」是一条**独立**路径：减号图标 → MemberRemovalList。
  //
  // 它不再与「查看全部」共用 removeAction。此前两条路径共用同一份配置，
  // 「查看全部」这个纯浏览入口也会下发移除按钮，把管理语义混进了浏览场景；
  // 而移除页又复用了带「添加成员」按钮的 title，右上角永远挂着一个「+」。
  // 现在：浏览路径只浏览，移除路径只移除，标题各自独立。
  const viewerUid = data.subscriberOfMe?.uid || WKApp.loginInfo.uid;
  const viewerRole = data.subscriberOfMe?.role;

  return new Section({
    rows: [
      new Row({
        cell: Subscribers,
        properties: {
          context,
          channel,
          key: channel.getChannelKey(),
          canManageBotAdmin: !!data.channelInfo?.orgData?.can_manage_bot_admin,
          onRemove: () => {
            // 「确认」按钮属于**路由表头**（RouteContextConfig.showFinishButton），
            // 不属于列表组件；所以批量提交的编排放在这里，组件只负责上报选择。
            // 这与「转让群主」（channelSettingGroupManagementRows）是同一套模式，不另造。
            let finishContext: FinishButtonContext | undefined;
            let selected: Subscriber[] = [];
            let confirming = false;
            let submitting = false;
            const removalPage = React.createRef<MemberRemovalList>();

            const syncFinishDisabled = () => {
              finishContext?.disable(submitting || selected.length === 0);
            };

            context.push(
              <MemberRemovalList
                ref={removalPage}
                channel={channel}
                // 名册不走 props：本页由 routeContext.push 推入，WKViewQueue 会把该 JSX
                // 存进它自己的 state，之后外部再怎么更新也不会给它新 props
                // （octo-web#95 记录过同一个坑）。名册一旦从这里传入就是冻结快照：
                // 成员变动收不到、加载态翻不了身、按 props 变化触发的清理永远不跑。
                // 改由组件内部的 Provider + SubscriberListVM 自己拉数据（与「查看全部」同构）。
                //
                // 传工厂而不是建好的搜索函数：索引要基于 VM 当前名册重建，否则它会和
                // props 一样被冻住，成员变动后搜到的还是旧名册。
                createLocalSearch={(members) =>
                  createChannelSettingMemberSearch(members)
                }
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
                // 「移出成员」页的完成按钮用 Octo 紫色（与选择圆圈同源），
                // 局部覆盖而不改全站 primary（其它路由表头仍为默认深黑）。
                finishButtonClassName: "wk-memberremoval-finish-btn",
                onFinishContext: (value) => {
                  finishContext = value;
                  // 进页时未选任何人，「确认」必须是置灰的。
                  finishContext.disable(true);
                },
                onFinish: () => {
                  if (confirming || submitting) return;
                  if (selected.length === 0) {
                    Toast.warning(
                      t("base.subscribers.removeSelectAtLeastOne")
                    );
                    return;
                  }
                  const count = selected.length;
                  const uids = selected.map((item) => item.uid);
                  confirming = true;
                  let attempted = false;
                  wkConfirm({
                    title: t("base.subscribers.removeMemberTitle"),
                    // 列出名字而不是只报个数：选中项是跨搜索存活的（刻意设计），所以
                    // 点「确认」时部分选中项可能正被搜索滤在屏外。对一个破坏性批量操作，
                    // “移出 3 人”不足以让人确认自己要踢的到底是哪 3 个。
                    content: t(
                      "base.subscribers.confirmRemoveBatchContent",
                      {
                        values: {
                          count,
                          // 与列表行用**同一个**解析器。早先这里只用
                          // `item.remark || item.name`，而行优先用 1:1 频道的个人备注，
                          // 于是「我给某人设过个人备注」时两边叫的名字不一样 ——
                          // 一个破坏性操作的确认框跟你刚勾的行对不上号，很容易误删。
                          names: selected
                            .map((item) => resolveSubscriberShowName(item))
                            .join("\u3001"),
                        },
                      }
                    ),
                    okText: t("base.subscribers.remove"),
                    okType: "danger",
                    onCancel: () => { confirming = false; },
                    onOk: async () => {
                      if (attempted) return;
                      const page = removalPage.current;
                      // A detached page must not submit a still-open modal's
                      // stale selection after navigation.
                      if (!page) {
                        confirming = false;
                        return;
                      }
                      attempted = true;
                      submitting = true;
                      syncFinishDisabled();
                      finishContext?.loading(true);
                      page?.setSubmissionPending(true);
                      try {
                        const evidence = await removeAndReconcileChannelSettingSubscribers({
                          channel,
                          uids,
                        });
                        if (!evidence || removalPage.current !== page) return;
                        page?.applySelectionEvidence(evidence);
                        if (evidence.absent.length === uids.length) {
                          Toast.success(t("base.subscribers.removalVerified"));
                          context.pop();
                          data.refresh?.();
                        } else {
                          Toast.warning(t("base.subscribers.removalUncertain"));
                          page?.refreshMembers();
                        }
                      } catch {
                        if (removalPage.current === page) {
                          Toast.warning(t("base.subscribers.removalUncertain"));
                          page?.refreshMembers();
                        }
                      } finally {
                        // Close this confirmation after an attempt. A retry must
                        // confirm the reconciled selection, not the old uid snapshot.
                        submitting = false;
                        confirming = false;
                        if (removalPage.current === page) {
                          page?.setSubmissionPending(false);
                          finishContext?.loading(false);
                          syncFinishDisabled();
                        }
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
