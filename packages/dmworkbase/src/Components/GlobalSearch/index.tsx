import { Component, ReactNode } from "react";
import React from "react";
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { Tabs } from '@douyinfe/semi-ui';
import Provider from "../../Service/Provider";
import GlobalSearchVM from "./vm";
import TabAll from "./tab-all";
import TabContacts from "./tab-contacts";
import TabGroup from "./tab-group";
import TabFile from "./tab-file";
import { Channel } from "wukongimjssdk";
import GlobalContentSearchPanel from "./GlobalContentSearchPanel";
import { createGlobalSearchApiDataSource } from "./dataSource";
import { isGlobalContentSearchEnabled } from "./feature";
import type {
  GlobalSearchDataSource,
} from "./types";
import type { ChannelSearchItem } from "../ChannelSearch/types";
import { canLocateChannelSearchItem } from "../ChannelSearch/locate";
import WKApp from "../../App";
import { t as translate } from "../../i18n";
import "./index.css";

interface GlobalSearchProps {
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
}

export default class GlobalSearch extends Component<GlobalSearchProps> {
    vm!: GlobalSearchVM

    // Shared factory across both content-tab panels so sender/channel caches
    // stay warm across tab switches and the `_search_file_types` fetch is
    // performed at most once per open.
    globalDataSource: GlobalSearchDataSource = createGlobalSearchApiDataSource();

    // RC #554 minor (Jerry-Xin @ 2026-07-09): read the feature flag on every
    // render instead of capturing it once as a class field — remote-config
    // flips (`WKApp.remoteConfig.messagesSearchOn`) should take effect while
    // the panel is mounted, without a page reload. `isGlobalContentSearchEnabled`
    // is a pure lookup on the always-fresh `WKApp.remoteConfig` singleton;
    // we also subscribe to `addConfigChangeListener` so a mid-session flip
    // triggers an immediate re-render (the parent MobX vm may not re-render
    // on remote-config alone).
    get contentSearchEnabled(): boolean {
        return isGlobalContentSearchEnabled();
    }

    private _removeConfigListener?: () => void;

    componentDidMount() {
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
    }


    // 同时挂载所有 tab 组件，通过 display 切换可见性。
    // 避免切 tab 时 unmount 导致 <img>/VisibilityTrigger 全部重建，进而重新
    // 触发头像请求（浏览器 HTTP cache 不一定命中，网络面板会看到"全量重拉"）。
    tabPanels(currentKey: string) {
        const vm = this.vm
        const onClickOf = (type: string) => (item: any) => {
            if (this.props.onClick) this.props.onClick(item, type)
        }
        const panelStyle = (key: string): React.CSSProperties =>
            currentKey === key ? {} : { display: "none" }

        const disabledCopy = (
            <div className="wk-global-search-disabled-copy">
                {translate("base.globalSearch.searchDisabled") ||
                    translate("base.globalSearch.searchFailedRetry")}
            </div>
        );

        // 在 channel 内搜索时 tabList 只返回 all / files，不会展示 contacts/groups。
        // 此时挂载 TabAll + TabFile 即可。
        if (vm.searchInChannel) {
            return <>
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
        }

        return <>
            <div style={panelStyle("contacts")}>
                <TabContacts
                    friends={vm.searchResult?.friends}
                    keyword={vm.keyword}
                    onClick={onClickOf("contacts")}
                />
            </div>
            <div style={panelStyle("groups")}>
                <TabGroup
                    groups={vm.searchResult?.groups}
                    keyword={vm.keyword}
                    onClick={onClickOf("group")}
                />
            </div>
            <div style={panelStyle("messages")}>
                {this.contentSearchEnabled ? (
                    <GlobalContentSearchPanel
                        tab="messages"
                        keyword={vm.keyword}
                        dataSource={this.globalDataSource}
                        onLocateMessage={this.handleLocate}
                        isActive={currentKey === "messages"}
                    />
                ) : disabledCopy}
            </div>
            <div style={panelStyle("files")}>
                {this.contentSearchEnabled ? (
                    <GlobalContentSearchPanel
                        tab="files"
                        keyword={vm.keyword}
                        dataSource={this.globalDataSource}
                        onLocateMessage={this.handleLocate}
                        isActive={currentKey === "files"}
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
        </>
    }

    render(): ReactNode {
        const { channel } = this.props;
        return <Provider
            create={() => {
                this.vm = new GlobalSearchVM()
                this.vm.channel = channel
                return this.vm
            }}
            render={(vm: GlobalSearchVM) => {

                return <div>
                    {
                        vm.searchInChannel ? <div style={{ fontSize: "14px", fontWeight: "500",width:"100%",textAlign:"center",marginBottom: "10px" }}>{vm.searchTitle}</div> : undefined
                    }
                    <Input
                        prefix={<IconSearch />}
                        showClear
                        style={{ height: "40px" }}
                        onCompositionStart={() => { vm.isComposing = true; }}
                        onCompositionEnd={(e: any) => {
                            vm.isComposing = false;
                            vm.handleInputChange(e.target.value);
                        }}
                        onChange={(value) => {
                            vm.handleInputChange(value);
                        }}></Input>
                    {vm.searchError && <div style={{ color: "#f5222d", fontSize: "13px", textAlign: "center", padding: "8px 0" }}>{vm.searchError}</div>}
                    <div className="wk-search-tabs">
                        <Tabs
                            tabList={vm.tabList}
                            onChange={key => {
                                vm.onTabClick(key);
                            }}
                        >
                            {this.tabPanels(vm.selectedTabKey)}
                        </Tabs>
                    </div>
                </div>
            }}>

        </Provider>
    }
}
