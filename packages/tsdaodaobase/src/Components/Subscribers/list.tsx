import { Component, ReactNode } from "react";
import Provider from "../../Service/Provider";
import { SubscriberListVM } from "./list_vm";
import React from "react";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import "./list.css";
import WKApp from "../../App";
import WKSDK, { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";
import WKAvatar from "../WKAvatar";
import { Checkbox } from "@douyinfe/semi-ui/lib/es/checkbox";
import { GroupRole } from "../../Service/Const";

export interface SubscriberListProps {
  channel: Channel;
  canSelect?: boolean; // 是否支持多选
  disableSelectList?: string[]; // 禁选列表
  onSelect?: (items: Subscriber[]) => void;
}

export interface SubscriberListState {
  selectedList: Subscriber[];
}

export class SubscriberList extends Component<
  SubscriberListProps,
  SubscriberListState
> {
  constructor(props: SubscriberListProps) {
    super(props);
    this.state = {
      selectedList: [],
    };
  }

  onSearch = (v: string, vm: SubscriberListVM) => {
    vm.search(v);
  };

  handleScroll = (e: React.UIEvent<HTMLDivElement>, vm: SubscriberListVM) => {
    const target = e.target as HTMLDivElement;
    const offset = 200;
    if (
      target.scrollTop + target.clientHeight + offset >=
      target.scrollHeight
    ) {
      console.log("到底了");
      vm.loadMoreSubscribersIfNeed();
    }
  };

  // 获取显示名称
  getShowName = (subscriber: Subscriber) => {
    // 优先显示个人备注
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(subscriber.uid, ChannelTypePerson)
    );
    if (
      channelInfo &&
      channelInfo.orgData.remark &&
      channelInfo.orgData.remark.trim() !== ""
    ) {
      return channelInfo.orgData.remark;
    }

    // 其次显示群内备注
    if (subscriber.remark && subscriber.remark.trim() !== "") {
      return subscriber.remark;
    }

    // 最后显示昵称
    return subscriber.name;
  };

  onItemClick = (subscriber: Subscriber) => {
    const { canSelect } = this.props;
    if (!canSelect) {
      WKApp.shared.baseContext.showUserInfo(subscriber.uid, this.props.channel);
      return;
    }
    this.checkItem(subscriber);
  };

  isDisableItem(id: string) {
    const { disableSelectList } = this.props;
    if (disableSelectList && disableSelectList.length > 0) {
      for (const disableSelect of disableSelectList) {
        if (disableSelect === id) {
          return true;
        }
      }
    }
    return false;
  }

  isCheckItem(item: Subscriber) {
    const { selectedList } = this.state;
    for (const selected of selectedList) {
      if (selected.uid === item.uid) {
        return true;
      }
    }
    return false;
  }

  checkItem(item: Subscriber) {
    const { selectedList } = this.state;
    const { onSelect } = this.props;
    let newSelectedList = selectedList;
    let found = -1;
    for (let index = 0; index < newSelectedList.length; index++) {
      const selected = newSelectedList[index];
      if (selected.uid === item.uid) {
        found = index;
        break;
      }
    }
    if (found >= 0) {
      newSelectedList.splice(found, 1);
    } else {
      newSelectedList = [item, ...selectedList];
    }

    this.setState({
      selectedList: newSelectedList,
    });
    if (onSelect) {
      onSelect(newSelectedList);
    }
  }

  getRoleName = (item: Subscriber) => {
    if (item.role === GroupRole.owner) {
      return "群主";
    } else if (item.role === GroupRole.manager) {
      return "管理员";
    } else {
      return "";
    }
  };

  render() {
    const { canSelect } = this.props;
    return (
      <Provider
        create={() => {
          return new SubscriberListVM(this.props.channel);
        }}
        render={(vm: SubscriberListVM) => {
          return (
            <div
              className="wk-subscrierlist"
              onScroll={(e) => {
                this.handleScroll(e, vm);
              }}
            >
              <div className="wk-indextable-search-box">
                <div className="wk-indextable-search-icon">
                  <IconSearchStroked
                    style={{ color: "#bbbfc4", fontSize: "20px" }}
                  />
                </div>
                <div className="wk-indextable-search-input">
                  <input
                    onChange={(v) => {
                      this.onSearch(v.target.value, vm);
                    }}
                    placeholder={"搜索"}
                    ref={(rf) => {}}
                    type="text"
                    style={{ fontSize: "17px" }}
                  />
                </div>
              </div>
              <div className="wk-subscrierlist-list">
                {vm.subscribers.map((item) => {
                  return (
                    <div
                      className="wk-subscrierlist-list-item"
                      key={item.uid}
                      onClick={() => {
                        this.onItemClick(item);
                      }}
                    >
                      {canSelect ? (
                        <div className="wk-indextable-checkbox">
                          <Checkbox
                            checked={
                              this.isDisableItem(item.uid) ||
                              this.isCheckItem(item)
                            }
                            disabled={this.isDisableItem(item.uid)}
                          ></Checkbox>
                        </div>
                      ) : undefined}
                      <div className="wk-subscrierlist-item-avatar">
                        <WKAvatar src={item.avatar}></WKAvatar>
                      </div>
                      <div className="wk-subscrierlist-item-content">
                        <div className="wk-subscrierlist-item-name">
                          {this.getShowName(item)}
                        </div>
                        <div className="wk-subscrierlist-item-desc">
                          {this.getRoleName(item)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      ></Provider>
    );
  }
}
