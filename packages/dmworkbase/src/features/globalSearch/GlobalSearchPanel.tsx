import { Component, ReactNode } from "react";
import React from "react";
import { Filter, X } from "lucide-react";
import Provider from "../../Service/Provider";
import GlobalSearchVM from "../../bridge/globalSearch/GlobalSearchVM";
import TabAll from "../../Components/GlobalSearch/tab-all";
import TabContacts from "../../Components/GlobalSearch/tab-contacts";
import TabGroup from "../../Components/GlobalSearch/tab-group";
import TabFile from "../../Components/GlobalSearch/tab-file";
import { Channel } from "wukongimjssdk";
import GlobalContentSearchPanel from "../../Components/GlobalSearch/GlobalContentSearchPanel";
import GlobalSearchFilterPanel from "../../Components/GlobalSearch/GlobalSearchFilterPanel";
import GlobalChatSearchPanel from "../globalChatSearch/GlobalChatSearchPanel";
import { createGlobalSearchApiDataSource } from "../../bridge/globalSearch/createGlobalSearchDataSource";
import { selectedGlobalSearchFilterValueCount } from "../../bridge/globalSearch/filterState";
import { isGlobalContentSearchEnabled } from "./feature";
import {
  defaultGlobalSearchFilters,
  type GlobalSearchDataSource,
  type GlobalSearchFilters,
} from "../../Service/SearchTypes";
import type { ChannelSearchItem } from "../../Service/SearchTypes";
import { canLocateChannelSearchItem } from "../../bridge/channelSearch/locate";
import WKApp from "../../App";
import { t as translate } from "../../i18n";
import SearchWorkspace from "../../ui/SearchWorkspace";
import "./global-search-panel.css";

export interface GlobalSearchProps {
  channel?: Channel; // 查询指定频道的聊天记录
  // item点击事件，传递item和type，type为contacts、group、message,file
  // NOTE: content-tab hits (messages / files via GlobalContentSearchPanel)
  // do NOT go through onClick — their items are camelCase ChannelSearchItem
  // shape and the legacy `handleGlobalSearchClick` consumer reads snake_case
  // (`item.channel.channel_id` / `item.payload.url`), which crashes. Content
  // tabs navigate via `handleLocate` (uses WKApp.endpoints.showConversation
  // directly) and close the modal via `hideModal`. onClick still services
  // the legacy contacts / group / TabAll / TabFile paths whose items keep
  // the snake_case shape.
  onClick?: (item: any, type: string) => void;
  // Called by handleLocate after content-tab navigation so the enclosing
  // modal can dismiss. Kept separate from onClick to avoid pushing a
  // camelCase item into the snake-case consumer.
  hideModal?: () => void;
  createViewModel?: () => GlobalSearchVM;
  dataSource?: GlobalSearchDataSource;
  contentSearchEnabled?: boolean;
  onLocateContentItem?: (item: ChannelSearchItem) => void;
  initialState?: Partial<GlobalSearchState>;
}

export interface GlobalSearchState {
  filterOpen: boolean;
  filters: GlobalSearchFilters;
  searchValue: string;
}

export default class GlobalSearch extends Component<
  GlobalSearchProps,
  GlobalSearchState
> {
  vm!: GlobalSearchVM;

  state: GlobalSearchState;

  // Shared factory across both content-tab panels so sender/channel caches
  // stay warm across tab switches and the `_search_file_types` fetch is
  // performed at most once per open.
  globalDataSource: GlobalSearchDataSource;

  constructor(props: GlobalSearchProps) {
    super(props);
    this.state = {
      filterOpen: false,
      filters: defaultGlobalSearchFilters(),
      searchValue: "",
      ...props.initialState,
    };
    this.globalDataSource =
      props.dataSource ?? createGlobalSearchApiDataSource();
  }

  // RC #554 minor (Jerry-Xin @ 2026-07-09): read the feature flag on every
  // render instead of capturing it once as a class field — remote-config
  // flips (`WKApp.remoteConfig.messagesSearchOn`) should take effect while
  // the panel is mounted, without a page reload. `isGlobalContentSearchEnabled`
  // is a pure lookup on the always-fresh `WKApp.remoteConfig` singleton;
  // we also subscribe to `addConfigChangeListener` so a mid-session flip
  // triggers an immediate re-render (the parent MobX vm may not re-render
  // on remote-config alone).
  get contentSearchEnabled(): boolean {
    if (this.props.contentSearchEnabled !== undefined) {
      return this.props.contentSearchEnabled;
    }
    return isGlobalContentSearchEnabled();
  }

  private _removeConfigListener?: () => void;

  componentDidMount() {
    if (this.props.contentSearchEnabled !== undefined) return;
    this._removeConfigListener = WKApp.remoteConfig.addConfigChangeListener(
      () => {
        this.forceUpdate();
      }
    );
  }

  componentWillUnmount() {
    this._removeConfigListener?.();
    this._removeConfigListener = undefined;
  }

  handleLocate = (item: ChannelSearchItem) => {
    // Guard: backend v10 always fills channel_id/channel_type on hits
    // (§9); if either is missing we can't build a Channel — no-op rather
    // than sending the user to a bogus conversation.
    if (!canLocateChannelSearchItem(item)) return;
    if (!item.channelId || typeof item.channelType !== "number") return;
    if (this.props.onLocateContentItem) {
      this.props.onLocateContentItem(item);
      this.props.hideModal?.();
      return;
    }
    // Do NOT forward `item` to `props.onClick` — content-tab items are
    // camelCase ChannelSearchItems and the legacy consumer expects
    // snake-case shapes (`item.channel.channel_id`, `item.payload.url`).
    // Navigate here, then let the parent close its modal via hideModal.
    try {
      // DM `channel_id` is already reversed to the peer uid by the
      // backend global path (backend §9.1 NEW-A) — do not re-derive.
      const channel = new Channel(item.channelId, item.channelType);
      WKApp.endpoints.showConversation(channel, {
        initLocateMessageSeq: item.messageSeq,
      });
    } catch (err) {
      // showConversation is expected to be present in the runtime;
      // log so we notice when the endpoint contract regresses instead
      // of silently landing the user on the same screen.
      // eslint-disable-next-line no-console
      console.warn("[GlobalSearch] showConversation failed", err);
    }
    this.props.hideModal?.();
  };

  // 同时挂载所有 tab 组件，通过 display 切换可见性。
  // 避免切 tab 时 unmount 导致 <img>/VisibilityTrigger 全部重建，进而重新
  // 触发头像请求（浏览器 HTTP cache 不一定命中，网络面板会看到"全量重拉"）。
  tabPanels(currentKey: string) {
    const vm = this.vm;
    const onClickOf = (type: string) => (item: any) => {
      if (this.props.onClick) this.props.onClick(item, type);
    };
    const panelStyle = (key: string): React.CSSProperties =>
      currentKey === key ? {} : { display: "none" };

    const disabledCopy = (
      <div className="wk-global-search-disabled-copy">
        {translate("base.globalSearch.searchDisabled") ||
          translate("base.globalSearch.searchFailedRetry")}
      </div>
    );

    // 在 channel 内搜索时 tabList 只返回 all / files，不会展示 contacts/groups。
    // 此时挂载 TabAll + TabFile 即可。
    if (vm.searchInChannel) {
      return (
        <>
          <div style={panelStyle("all")}>
            <TabAll
              searchResult={vm.searchResult}
              keyword={vm.keyword}
              loadMore={() => vm.loadMore()}
              onClick={(item, type) => onClickOf(type)(item)}
            />
          </div>
          <div style={panelStyle("files")}>
            <TabFile
              files={vm.searchResult?.messages}
              keyword={vm.keyword}
              loadMore={() => vm.loadMore()}
              onClick={onClickOf("file")}
            />
          </div>
        </>
      );
    }

    const isContentTab = currentKey === "messages" || currentKey === "files";
    const showSharedFilter =
      this.contentSearchEnabled && this.state.filterOpen && isContentTab;

    return (
      <div
        className={`wk-search-tabs__content-shell${
          showSharedFilter ? " has-filter" : ""
        }`}
      >
        <div className="wk-search-tabs__panel" style={panelStyle("contacts")}>
          <TabContacts
            friends={vm.searchResult?.friends}
            keyword={vm.keyword}
            onClick={onClickOf("contacts")}
          />
        </div>
        <div className="wk-search-tabs__panel" style={panelStyle("groups")}>
          <TabGroup
            groups={vm.searchResult?.groups}
            keyword={vm.keyword}
            onClick={onClickOf("group")}
          />
        </div>
        <div className="wk-search-tabs__panel" style={panelStyle("messages")}>
          {this.contentSearchEnabled ? (
            <GlobalChatSearchPanel
              keyword={vm.keyword}
              dataSource={this.globalDataSource}
              onLocateMessage={this.handleLocate}
              isActive={currentKey === "messages"}
              filters={this.state.filters}
            />
          ) : (
            disabledCopy
          )}
        </div>
        <div className="wk-search-tabs__panel" style={panelStyle("files")}>
          {this.contentSearchEnabled ? (
            <GlobalContentSearchPanel
              tab="files"
              keyword={vm.keyword}
              dataSource={this.globalDataSource}
              onLocateMessage={this.handleLocate}
              isActive={currentKey === "files"}
              filters={this.state.filters}
            />
          ) : (
            <TabFile
              files={vm.searchResult?.messages}
              keyword={vm.keyword}
              loadMore={() => vm.loadMore()}
              onClick={onClickOf("file")}
            />
          )}
        </div>
        {showSharedFilter && (
          <aside className="wk-search-tabs__shared-filter">
            <GlobalSearchFilterPanel
              mode="sidebar"
              tab={currentKey === "files" ? "files" : "messages"}
              keyword={vm.keyword}
              filters={this.state.filters}
              dataSource={this.globalDataSource}
              onApply={(filters) => this.setState({ filters })}
            />
          </aside>
        )}
      </div>
    );
  }

  render(): ReactNode {
    const { channel } = this.props;
    return (
      <Provider
        create={() => {
          this.vm = this.props.createViewModel?.() ?? new GlobalSearchVM();
          this.vm.channel = channel;
          if (this.props.initialState?.searchValue !== undefined) {
            this.vm.keyword = this.props.initialState.searchValue;
          }
          return this.vm;
        }}
        render={(vm: GlobalSearchVM) => {
          const filterCount = selectedGlobalSearchFilterValueCount(
            this.state.filters
          );
          const isGlobalContentTab =
            vm.selectedTabKey === "messages" || vm.selectedTabKey === "files";
          return (
            <div>
              {vm.searchInChannel ? (
                <div className="wk-global-search-channel-title">
                  {vm.searchTitle}
                </div>
              ) : undefined}
              <div className="wk-search-tabs">
                <SearchWorkspace
                  search={{
                    value: this.state.searchValue,
                    placeholder: translate("base.globalSearch.placeholder"),
                    autoFocus: true,
                    onCompositionStart: () => {
                      vm.isComposing = true;
                    },
                    onCompositionEnd: (event) => {
                      const value = event.currentTarget.value;
                      vm.isComposing = false;
                      this.setState({ searchValue: value });
                      vm.handleInputChange(value);
                    },
                    onChange: (value) => {
                      this.setState({ searchValue: value });
                      if (!vm.isComposing) vm.handleInputChange(value);
                    },
                    trailing: this.state.searchValue ? (
                      <button
                        type="button"
                        className="wk-global-search-clear"
                        aria-label={translate("base.globalSearch.clear")}
                        onClick={() => {
                          this.setState({ searchValue: "" });
                          vm.handleInputChange("");
                        }}
                      >
                        <X size={16} />
                      </button>
                    ) : undefined,
                  }}
                  tabs={vm.tabList.map((tab) => ({
                    key: tab.itemKey,
                    label: tab.tab,
                  }))}
                  activeTab={vm.selectedTabKey}
                  onTabChange={(key) => vm.onTabClick(key)}
                  error={vm.searchError}
                  actions={
                    this.contentSearchEnabled && isGlobalContentTab ? (
                      <>
                        {filterCount > 0 && (
                          <button
                            type="button"
                            className="wk-search-tabs__filter-reset"
                            onClick={() =>
                              this.setState({
                                filters: defaultGlobalSearchFilters(),
                              })
                            }
                          >
                            {translate(
                              "base.globalSearch.aggregated.resetFilters"
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`wk-search-tabs__filter-trigger${
                            this.state.filterOpen ? " is-open" : ""
                          }${filterCount > 0 ? " has-filters" : ""}`}
                          aria-expanded={this.state.filterOpen}
                          onClick={() =>
                            this.setState(({ filterOpen }) => ({
                              filterOpen: !filterOpen,
                            }))
                          }
                        >
                          <Filter
                            size={16}
                            fill={
                              this.state.filterOpen ? "currentColor" : "none"
                            }
                          />
                          {filterCount > 0 && (
                            <span className="wk-search-tabs__filter-count">
                              {filterCount}
                            </span>
                          )}
                          <span>
                            {translate(
                              "base.globalSearch.aggregated.filterTitle"
                            )}
                          </span>
                        </button>
                      </>
                    ) : undefined
                  }
                >
                  {this.tabPanels(vm.selectedTabKey)}
                </SearchWorkspace>
              </div>
            </div>
          );
        }}
      ></Provider>
    );
  }
}
