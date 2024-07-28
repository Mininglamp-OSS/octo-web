import { Channel, WKSDK, Subscriber } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import Provider from "../../Service/Provider";
import WKApp from "../../App";
import { SubscribersVM } from "./vm";
import IndexTable, { IndexTableItem } from "../IndexTable";
import WKBase, { WKBaseContext } from "../WKBase";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";

import "./index.css";

export interface SubscribersProps {
  context: RouteContext<any>;
  channel: any;
  onAdd?: () => void;
  onRemove?: () => void;
}

export class Subscribers extends Component<SubscribersProps> {
  baseContext!: WKBaseContext;

  subscriberUI(subscriber: Subscriber) {
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
        <img src={WKApp.shared.avatarUser(subscriber.uid)} alt=""></img>
        <div className="wk-subscribers-item-name">
          {subscriber.remark || subscriber.name}
        </div>
      </div>
    );
  }

  render() {
    const { context, onAdd, onRemove, channel } = this.props;
    const data = context.routeData() as ChannelSettingRouteData;
    const disableSelectList = data.subscribers.map((subscriber) => {
      return subscriber.uid;
    });
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
                          console.log(channel);
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
                      disableSelectList,
                      <div className="wk-subscribers-item">
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
                        <IndexTable
                          items={vm.subscribers.map((s) => {
                            const vercode = s.orgData?.vercode;
                            return new IndexTableItem(
                              s.uid,
                              s.remark || s.name,
                              WKApp.shared.avatarUser(s.uid),
                            );
                          })}
                          onSelect={(item: IndexTableItem[]) => {
                            const optItem = item[0];
                            WKApp.shared.baseContext.showUserInfo(
                              optItem.id,
                              channel,
                            );
                          }}
                        ></IndexTable>,
                        new RouteContextConfig({
                          title: "成员列表",
                        })
                      );
                    }}
                  >
                    查看更多群成员
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
