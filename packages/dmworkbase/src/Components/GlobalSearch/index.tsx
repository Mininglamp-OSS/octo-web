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

interface GlobalSearchProps {
    channel?: Channel; // 查询指定频道的聊天记录
    // item点击事件，传递item和type，type为contacts、group、message,file
    onClick?: (item: any, type: string) => void;
    // #397: 关闭外层搜索框（透传给 TabContacts）
    onClose?: () => void;
}

export default class GlobalSearch extends Component<GlobalSearchProps> {
    vm!: GlobalSearchVM


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
                    onClose={this.props.onClose}
                />
            </div>
            <div style={panelStyle("groups")}>
                <TabGroup
                    groups={vm.searchResult?.groups}
                    keyword={vm.keyword}
                    onClick={onClickOf("group")}
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