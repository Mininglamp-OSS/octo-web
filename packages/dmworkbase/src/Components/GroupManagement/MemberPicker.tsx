import React, { Component } from "react";
import { Search } from "lucide-react";
import { Channel, Subscriber } from "wukongimjssdk";
import Provider from "../../Service/Provider";
import { SubscriberListVM } from "../Subscribers/list_vm";
import WKAvatar from "../WKAvatar";
import { debounce, throttle } from "../../Utils/rateLimit";
import "./MemberPicker.css";

export interface GroupManagementMemberPickerLabels {
  searchPlaceholder: string;
  empty: string;
  emptySearch: string;
}

export interface GroupManagementMemberPickerProps {
  channel: Channel;
  disabledUids?: string[];
  filter: (subscriber: Subscriber) => boolean;
  labels: GroupManagementMemberPickerLabels;
  onSelect: (items: Subscriber[]) => void;
}

interface GroupManagementMemberPickerState {
  selectedList: Subscriber[];
  keyword: string;
}

export class GroupManagementMemberPicker extends Component<
  GroupManagementMemberPickerProps,
  GroupManagementMemberPickerState
> {
  private debouncedSearchMap = new WeakMap<
    SubscriberListVM,
    (value: string) => void
  >();
  private throttledScrollMap = new WeakMap<
    SubscriberListVM,
    (event: React.UIEvent<HTMLDivElement>) => void
  >();

  constructor(props: GroupManagementMemberPickerProps) {
    super(props);
    this.state = {
      selectedList: [],
      keyword: "",
    };
  }

  private isDisabled = (uid: string) => {
    return (this.props.disabledUids ?? []).includes(uid);
  };

  private isSelected = (uid: string) => {
    return this.state.selectedList.some((item) => item.uid === uid);
  };

  private displayName = (subscriber: Subscriber) => {
    return subscriber.remark || subscriber.name || subscriber.uid;
  };

  private toggleSelect = (subscriber: Subscriber) => {
    if (this.isDisabled(subscriber.uid)) return;

    const exists = this.state.selectedList.some(
      (item) => item.uid === subscriber.uid
    );
    const selectedList = exists
      ? this.state.selectedList.filter((item) => item.uid !== subscriber.uid)
      : [subscriber, ...this.state.selectedList];

    this.setState({ selectedList });
    this.props.onSelect(selectedList);
  };

  private getDebouncedSearch = (vm: SubscriberListVM) => {
    if (!this.debouncedSearchMap.has(vm)) {
      this.debouncedSearchMap.set(
        vm,
        debounce((value: string) => {
          vm.search(value);
        }, 250)
      );
    }
    return this.debouncedSearchMap.get(vm)!;
  };

  private handleKeywordChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    vm: SubscriberListVM
  ) => {
    const keyword = event.target.value;
    this.setState({ keyword });
    this.getDebouncedSearch(vm)(keyword);
  };

  private getThrottledScroll = (vm: SubscriberListVM) => {
    if (!this.throttledScrollMap.has(vm)) {
      this.throttledScrollMap.set(
        vm,
        throttle((event: React.UIEvent<HTMLDivElement>) => {
          const target = event.target as HTMLDivElement;
          const offset = 160;
          if (
            target.scrollTop + target.clientHeight + offset >=
            target.scrollHeight
          ) {
            void vm.loadMoreSubscribersIfNeed();
          }
        }, 100)
      );
    }
    return this.throttledScrollMap.get(vm)!;
  };

  private handleScroll = (
    event: React.UIEvent<HTMLDivElement>,
    vm: SubscriberListVM
  ) => {
    this.getThrottledScroll(vm)(event);
  };

  render() {
    return (
      <Provider
        create={() =>
          new SubscriberListVM(
            this.props.channel,
            (subscriber) =>
              this.props.filter(subscriber) && !this.isDisabled(subscriber.uid)
          )
        }
        render={(vm: SubscriberListVM) => {
          const hasKeyword = this.state.keyword.trim().length > 0;
          const emptyLabel = hasKeyword
            ? this.props.labels.emptySearch
            : this.props.labels.empty;

          return (
            <div className="wk-group-member-picker">
              <div className="wk-group-member-picker-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={this.state.keyword}
                  onChange={(event) => this.handleKeywordChange(event, vm)}
                  placeholder={this.props.labels.searchPlaceholder}
                />
              </div>

              <div
                className="wk-group-member-picker-list"
                onScroll={(event) => this.handleScroll(event, vm)}
              >
                {vm.subscribers.length === 0 ? (
                  <div className="wk-group-member-picker-empty">
                    {emptyLabel}
                  </div>
                ) : (
                  vm.subscribers.map((subscriber) => {
                    const selected = this.isSelected(subscriber.uid);
                    const name = this.displayName(subscriber);
                    return (
                      <button
                        key={subscriber.uid}
                        type="button"
                        className="wk-group-member-picker-item"
                        onClick={() => this.toggleSelect(subscriber)}
                      >
                        <span
                          className={`wk-group-member-picker-check${
                            selected
                              ? " wk-group-member-picker-check--selected"
                              : ""
                          }`}
                          role="checkbox"
                          aria-checked={selected}
                        >
                          {selected && (
                            <span className="wk-group-member-picker-check-dot" />
                          )}
                        </span>
                        <span className="wk-group-member-picker-avatar">
                          <WKAvatar src={subscriber.avatar} />
                        </span>
                        <span
                          className="wk-group-member-picker-name"
                          title={name}
                        >
                          {name}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        }}
      />
    );
  }
}
