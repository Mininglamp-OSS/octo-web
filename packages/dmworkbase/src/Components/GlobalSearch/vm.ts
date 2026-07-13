import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson, MessageContentManager, SystemContent } from "wukongimjssdk";
import APIClient from "../../Service/APIClient";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { ProviderListener } from "../../Service/Provider";
import { debounce } from "../../Utils/rateLimit";
import { t } from "../../i18n";

export default class GlobalSearchVM extends ProviderListener {
    // 选中的tab组件
    private _selectedTabKey = "contacts";

    public page = 1 // 当前页码
    public limit = 20 // 每页条数
    public keyword = "" // 搜索关键字
    public searchResult: any
    public isComposing: boolean = false; // 是否正在输入(防止中文输入法干扰)
    public loadMoreing = false; // 是否正在加载更多中
    public loadFinish = false; // 是否加载完成
    public contentTypes = new Array<number>() // 内容类型
    private channelInfoListener!: ChannelInfoListener;
    public channel?: Channel // 查询指定频道的消息
    private requestId = 0 // 请求计数器，用于处理竞态条件
    public searchError: string | null = null // 搜索失败错误信息
    // tab数据列表
    public get tabList() {
        if (this.searchInChannel) {
            return [
                { tab: t("base.globalSearch.tab.chat"), itemKey: 'all' },
                { tab: t("base.globalSearch.tab.files"), itemKey: 'files' },
            ];
        }
        return [
            { tab: t("base.globalSearch.tab.contacts"), itemKey: 'contacts' },
            { tab: t("base.globalSearch.tab.groups"), itemKey: 'groups' },
            { tab: t("base.globalSearch.tab.chat"), itemKey: 'messages' },
            { tab: t("base.globalSearch.tab.files"), itemKey: 'files' },
        ];
    }

    public get selectedTabKey() {
        return this._selectedTabKey;
    }

    public set selectedTabKey(value: string) {
        this._selectedTabKey = value;
        this.notifyListener()
    }

    // 是否在频道内搜索
    public get searchInChannel(): boolean {
        return this.channel !== undefined
    }
    // 搜索标题
    public get searchTitle() {
        if (this.searchInChannel) {
            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(this.channel!)
            if(channelInfo) {
                return t("base.globalSearch.chatHistoryWith", {
                    values: { name: channelInfo.title },
                });
            }
            return ""
        }
        return undefined
    }

    // tab选中事件
    // 优化：/search/global 一次返回 friends / groups / messages 全部结果，
    // 切 contacts / groups 不必重发搜索，仅切换 UI 即可，避免打开弹窗后每次
    // 点 tab 都触发一次服务端搜索。files tab 依赖 content_type 过滤，仍需重发。
    public onTabClick(key: string) {
        if (key === "files") {
            this.contentTypes = [MessageContentTypeConst.file]
            this.initLoad()
            this.requestSearch()
        } else if (this.selectedTabKey === "files") {
            // 从 files 切回 contacts/groups，content_type 需要清空并重发一次
            this.contentTypes = []
            this.initLoad()
            this.requestSearch()
        }
        this.selectedTabKey = key;
    }

    didMount(): void {
        this.requestSearch()

        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo.channel.channelType !== ChannelTypePerson) {
                return
            }
            if (this.searchResult?.messages && this.searchResult.messages.length > 0) {
                this.searchResult.messages.forEach((item: any) => {
                    if (item.from_uid === channelInfo.channel.channelID) {
                        this.notifyListener()
                        return
                    }
                })
            }
        }

        WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }

    didUnMount(): void {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    // 输入框输入事件 (debounced to reduce API calls)
    public handleInputChange = debounce((value: string) => {
        if (!this.isComposing) {
            this.keyword = value;
            this.initLoad()
            this.requestSearch();
        }
    }, 300);

    public initLoad() {
        this.page = 1
        this.loadFinish = false
        this.loadMoreing = false
        this.searchResult = null
        this.notifyListener()
    }

    // 请求搜索
    public requestSearch() {
        // 递增请求计数器，用于识别当前请求
        this.requestId++
        const currentRequestId = this.requestId

        this.searchError = null

        const param: any = {
            keyword: this.keyword || "",
            page: this.page,
            limit: this.limit,
            content_type: this.contentTypes
        }

        if (this.channel) {
            param.channel_id = this.channel.channelID
            param.channel_type = this.channel.channelType
            param.only_message = 1
        }

        const spaceId = WKApp.shared.currentSpaceId;
        const searchUrl = spaceId ? `/search/global?space_id=${encodeURIComponent(spaceId)}` : "/search/global";
        APIClient.shared.post(searchUrl, param).then(res => {
            // 忽略过期请求的响应，只处理最新请求的结果
            if (currentRequestId !== this.requestId) {
                return
            }

            if (res.messages.length < this.limit) {
                this.loadFinish = true
            }
            if (this.loadMoreing) {
                if (this.searchResult) {
                    this.searchResult.messages = this.searchResult.messages?.concat(res.messages)
                } else {
                    this.searchResult = res
                }

            } else {
                this.searchResult = res
            }

            // 替换备注如果有备注的话
            this.searchResult.friends?.forEach((v: any) => {
                if (v.channel_remark && v.channel_remark !== "") {
                    v.channel_name = v.channel_remark
                }
            })
            this.searchResult.groups?.forEach((v: any) => {
                if (v.channel_remark && v.channel_remark !== "") {
                    v.channel_name = v.channel_remark
                }
            })
            this.searchResult.messages?.forEach((v: any) => {
                if (v.channel.channel_remark && v.channel.channel_remark !== "") {
                    v.channel.channel_name = v.channel.channel_remark
                }

                // 解析消息内容
                if(v.payload) {
                    const contentType = v.payload.type

                    const messageContent = MessageContentManager.shared().getMessageContent(contentType)
                    if (messageContent) {
                        messageContent.decode(this.jsonToUint8Array(v.payload))

                        if(messageContent instanceof SystemContent) {
                            messageContent.content["content"] = t("base.globalSearch.systemMessage")
                        }

                        v.content = messageContent
                    }
                }

            })
        }).catch((err) => {
            console.error("[GlobalSearch] search failed:", err)
            if (currentRequestId === this.requestId) {
                this.searchError = t("base.globalSearch.searchFailedRetry")
                this.notifyListener()
            }
        }).finally(() => {
            // 只有最新请求完成时才更新 loadMoreing 状态
            if (currentRequestId === this.requestId) {
                this.loadMoreing = false
                this.notifyListener()
            }
        })
    }

    jsonToUint8Array(json: any): Uint8Array {
        // 将 JSON 对象转换为字符串
        const jsonString = JSON.stringify(json);

       return this.stringToUint8Array(jsonString)
    }

     stringToUint8Array(str: string): Uint8Array {
        return new TextEncoder().encode(str)
    }

    // 加载更多消息
    loadMore() {
        if (this.loadMoreing) {
            return
        }
        this.loadMoreing = true
        this.page++
        this.requestSearch()
    }
}
