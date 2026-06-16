import React, { Component, ReactNode } from "react"
import { ListItemSwitch, ListItemSwitchContext } from "../ListItem"
import { MentionFreeVM, BotGroupItem } from "./vm"
import { I18nContext } from "../../i18n"

/**
 * MentionFreeList —— L3「💬 免@回答」群列表（octo-web#235 / YUJ-2838）。
 *
 * 数据：GET /v1/robot/:robot_id/groups（cursor 分页，octo-server#237）。
 * 交互（issue「L3 交互」）：
 *   - 搜索：客户端过滤已加载项（VM.setSearchKeyword + visibleGroups）。
 *   - 分区：已开启免@回答置顶（enabled）+ 其他群（others），见 VM.visibleGroups。
 *   - 分页：cursor 懒加载，滚动触底 loadMore。
 *   - 开关：ListItemSwitch（ListItem:86）onCheck 仿 mute（module.tsx:1773-1783）：
 *       ctx.loading=true → await VM.toggleMentionFree → 成功 ctx.loading=false，
 *       失败 ctx.loading=false + VM 已 Toast（开关 checked 由 VM 状态未变而回弹）。
 *       开 → PUT mention_pref{no_mention:1}；关 → DELETE（删记录回退默认）。
 *
 * 订阅模型（octo-web#95 同款）：本组件经 routeContext.push 进入 WKViewQueue，
 * 脱离了 Provider 的 render-prop 重渲染链。所以必须 vm.addListener 显式订阅
 * notifyListener，命中时 forceUpdate 重读 vm.groups / loading 等字段，否则
 * loadGroups 完成后列表永远停在初始空态。class 组件用实例方法做订阅（dmworkbase
 * 仍是 React 17，与 testing-library/react 18 混跑时 hooks 会报 invalid hook call，
 * 与 PersonaListBody 选择 class 形态同因）。
 */
export interface MentionFreeListProps {
    vm: MentionFreeVM
}

export default class MentionFreeList extends Component<MentionFreeListProps> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    private unsubscribe?: () => void
    private scrollRef = React.createRef<HTMLDivElement>()

    componentDidMount(): void {
        const { vm } = this.props
        // 订阅 VM 变化（脱离 Provider render-prop 链，见类注释）。
        this.unsubscribe = vm.addListener(() => this.forceUpdate())
        // 兜底首拉：Provider.didMount 会调 vm.didMount→loadGroups，但本组件作为
        // 被 push 的子页，挂载时机与 Provider 生命周期不完全同步；这里在「未加载且
        // 不在加载中」时补一次，loadGroups 内有 isStale 守卫，重复触发无害。
        if (
            !vm.loading &&
            vm.groups.length === 0 &&
            !vm.loadError &&
            !vm.isBackendMissing
        ) {
            void vm.loadGroups()
        }
    }

    componentWillUnmount(): void {
        if (this.unsubscribe) this.unsubscribe()
    }

    /** 滚动触底（距底 < 48px）懒加载下一页。 */
    private handleScroll = (): void => {
        const el = this.scrollRef.current
        if (!el) return
        const { scrollTop, clientHeight, scrollHeight } = el
        if (scrollHeight - (scrollTop + clientHeight) < 48) {
            void this.props.vm.loadMore()
        }
    }

    private renderRow(g: BotGroupItem): ReactNode {
        const { vm } = this.props
        return (
            <ListItemSwitch
                key={g.group_no}
                style={{}}
                title={g.name || g.group_no}
                checked={g.no_mention}
                onCheck={(next: boolean, ctx?: ListItemSwitchContext) => {
                    // 仿 mute（module.tsx:1773-1783）：loading 占位 + catch 回弹。
                    if (ctx) ctx.loading = true
                    void vm.toggleMentionFree(g.group_no, next).finally(() => {
                        if (ctx) ctx.loading = false
                    })
                }}
            />
        )
    }

    render(): ReactNode {
        const { vm } = this.props
        const { t } = this.context

        // 首屏加载
        if (vm.loading) {
            return (
                <div className="wk-bot-manage-mention">
                    <div className="wk-bot-manage-loading">
                        {t("base.botManage.loading")}
                    </div>
                </div>
            )
        }

        // 后端未上线（404）→ 功能即将上线
        if (vm.isBackendMissing) {
            return (
                <div className="wk-bot-manage-mention">
                    <div className="wk-bot-manage-empty">
                        {t("base.botManage.backendComingSoon")}
                        <br />
                        {t("base.botManage.stayTuned")}
                    </div>
                </div>
            )
        }

        // 其他错误 → 重试
        if (vm.loadError) {
            return (
                <div className="wk-bot-manage-mention">
                    <div className="wk-bot-manage-error">
                        {t("base.botManage.loadFailed")}
                        <div
                            className="wk-bot-manage-error-retry"
                            onClick={() => void vm.loadGroups()}
                        >
                            {t("base.botManage.reload")}
                        </div>
                    </div>
                </div>
            )
        }

        const { enabled, others } = vm.visibleGroups()
        const isEmpty = enabled.length === 0 && others.length === 0

        return (
            <div className="wk-bot-manage-mention">
                <div className="wk-bot-manage-search">
                    <input
                        className="wk-bot-manage-search-input"
                        type="text"
                        placeholder={t("base.botManage.mentionFree.searchPlaceholder")}
                        value={vm.searchKeyword}
                        onChange={(e) => vm.setSearchKeyword(e.target.value)}
                        data-testid="bot-manage-mention-search"
                    />
                </div>
                <div
                    className="wk-bot-manage-list"
                    ref={this.scrollRef}
                    onScroll={this.handleScroll}
                    data-testid="bot-manage-mention-list"
                >
                    {isEmpty && (
                        <div className="wk-bot-manage-empty">
                            {vm.searchKeyword.trim()
                                ? t("base.botManage.mentionFree.noSearchResult")
                                : t("base.botManage.mentionFree.empty")}
                        </div>
                    )}

                    {enabled.length > 0 && (
                        <>
                            <div className="wk-bot-manage-section-title">
                                {t("base.botManage.mentionFree.sectionEnabled", {
                                    values: { count: enabled.length },
                                })}
                            </div>
                            {enabled.map((g) => this.renderRow(g))}
                        </>
                    )}

                    {others.length > 0 && (
                        <>
                            <div className="wk-bot-manage-section-title">
                                {t("base.botManage.mentionFree.sectionOthers")}
                            </div>
                            {others.map((g) => this.renderRow(g))}
                        </>
                    )}

                    {vm.loadingMore && (
                        <div className="wk-bot-manage-loadmore">
                            {t("base.botManage.loading")}
                        </div>
                    )}
                </div>
            </div>
        )
    }
}

export { MentionFreeList }
