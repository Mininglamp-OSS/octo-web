import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import Provider from "../../Service/Provider";
import WKApp from "../../App";
import "./index.css";
import { SubscribersVM } from "./vm";
import IndexTable, { IndexTableItem } from "../IndexTable";
import WKBase, { WKBaseContext } from "../WKBase";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { SubscriberList, SubscriberListProps } from "./list";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { isRealnameVerified } from "../../Utils/displayName";
import { GroupRole } from "../../Service/Const";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import { I18nContext } from "../../i18n";
import { createChannelSettingMemberSearch } from "../../features/channelSetting/channelSettingMemberSearch";
import WKAvatar from "../WKAvatar";

export interface SubscribersProps {
  context: RouteContext<any>;
  channel: any;
  onAdd?: () => void;
  onRemove?: () => void;
  /**
   * 透传给「查看全部」打开的成员列表（octo-web#1511）。
   *
   * 之前这条路径不带 removeAction，移除按钮只存在于群主/管理员专用的
   * 「移除成员」图标路径里；普通成员即使拥有某个 bot 也没有任何入口。
   * 逐行是否渲染仍由 removeAction.canRemove 决定，因此对不拥有 bot 的
   * 普通成员没有任何可见变化。
   */
  removeAction?: SubscriberListProps["removeAction"];
}

export class Subscribers extends Component<SubscribersProps> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  baseContext!: WKBaseContext;

  subscriberUI(subscriber: Subscriber) {
    // 外部成员按当前查看 Space 相对渲染；采用企微风格
    // 「昵称 @SpaceName」后缀格式，无紫色「外部」Tag、无「来自」前缀。
    const { isExternal, sourceSpaceName } = resolveExternalForViewer({
      homeSpaceId: subscriber.orgData?.home_space_id,
      homeSpaceName: subscriber.orgData?.home_space_name,
      isExternalLegacy: subscriber.orgData?.is_external,
      sourceSpaceNameLegacy: subscriber.orgData?.source_space_name,
    });
    return (
      <div
        key={subscriber.uid}
        className="wk-subscribers-item"
        onClick={() => {
          const vercode = subscriber.orgData?.vercode;
          WKApp.shared.baseContext.showUserInfo(
            subscriber.uid,
            subscriber.channel,
            vercode
          );
        }}
      >
        <div className="wk-subscribers-item-avatar-wrap">
          <WKAvatar
            channel={new Channel(subscriber.uid, ChannelTypePerson)}
          />
          {subscriber.role === GroupRole.owner && (
            <span className="wk-subscribers-item-role-badge wk-subscribers-item-role-badge-owner">
              {this.context.t("base.subscribers.role.owner")}
            </span>
          )}
          {subscriber.role === GroupRole.manager && (
            <span className="wk-subscribers-item-role-badge wk-subscribers-item-role-badge-manager">
              {this.context.t("base.subscribers.role.manager")}
            </span>
          )}
        </div>
        <div className="wk-subscribers-item-name">
          {subscriber.remark || subscriber.name}
          {/* Epic dmwork-web#1169 Phase A: 群成员列表实名徽章
              （icon variant），已实名才显示。*/}
          {isRealnameVerified(subscriber.orgData) && (
            <RealnameVerifiedBadge variant="icon" />
          )}
        </div>
        {isExternal && sourceSpaceName && (
          <span
            className="wk-subscribers-item-space"
            title={`@${sourceSpaceName}`}
          >
            @{sourceSpaceName}
          </span>
        )}
      </div>
    );
  }

  render() {
    const { context, onAdd, onRemove, channel, removeAction } = this.props;
    return (
      <Provider
        create={() => {
          return new SubscribersVM(context);
        }}
        render={(vm: SubscribersVM) => {
          return (
            <WKBase
              onContext={(baseContext) => {
                this.baseContext = baseContext;
              }}
            >
              <div className="wk-subscribers">
                <div className="wk-subscribers-content">
                  {vm.subscribersTop.map((subscriber) => {
                    return this.subscriberUI(subscriber);
                  })}
                  {/* {vm.showAdd() ? (
                    <div
                      className="wk-subscribers-item"
                      onClick={() => {
                        if (onAdd) {
                          onAdd();
                        }
                      }}
                    >
                      <img
                        src={require("./assets/icon_add_more_gray.png")}
                        alt=""
                      ></img>
                    </div>
                  ) : undefined} */}
                  {vm.showAdd()
                    ? WKApp.endpoints.organizationalTool(
                        channel,
                        <div
                          className="wk-subscribers-item"
                          data-testid="group-member-add-btn"
                        >
                          <img
                            src={require("./assets/icon_add_more_gray.png")}
                            alt=""
                          />
                        </div>
                      )
                    : undefined}
                  {vm.showRemove() ? (
                    <div
                      className="wk-subscribers-item"
                      data-testid="group-member-remove-btn"
                      onClick={() => {
                        if (onRemove) {
                          onRemove();
                        }
                      }}
                    >
                      <img
                        src={require("./assets/icon_delete_more_gray.png")}
                        alt=""
                      />
                    </div>
                  ) : undefined}
                </div>
                {vm.hasMoreSubscribers() ? (
                  <div
                    className="wk-subscribers-more"
                    onClick={() => {
                      context.push(
                        <SubscriberList
                          channel={channel}
                          removeAction={removeAction}
                          localSearch={createChannelSettingMemberSearch(
                            vm.subscribers
                          )}
                        />,
                        new RouteContextConfig({
                          title: this.context.t(
                            "base.subscribers.memberListWithCount",
                            { values: { count: vm.memberCount() } }
                          ),
                        })
                      );
                    }}
                  >
                    {this.context.t("base.subscribers.viewAll", {
                      values: { count: vm.memberCount() },
                    })}
                  </div>
                ) : undefined}
              </div>
            </WKBase>
          );
        }}
      ></Provider>
    );
  }
}
