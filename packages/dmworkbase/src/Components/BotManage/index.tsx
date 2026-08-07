import { Toast } from "@douyinfe/semi-ui"
import React, { Component, ReactNode } from "react"
import RouteContext, { RouteContextConfig } from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import WKModal from "../WKModal"
import RoutePage from "../RoutePage"
import { MentionFreeVM } from "../../bridge/profileDetail/BotManageVM"
import { BotCardSettingsVM } from "../../bridge/profileDetail/BotCardSettingsVM"
import {
    BOT_CARD_DISPLAY_KEY,
    BOT_CARD_INTERACTION_KEY,
    BOT_CARD_REASONING_KEY,
} from "../../bridge/profileDetail/botCardSettings"
import { I18nContext } from "../../i18n"
import BotManageView, {
    CardSettingsView,
    MentionFreeListView,
    type BotCardSettingsLabels,
    type BotManageGroupItem,
    type BotManageViewLabels,
} from "../../ui/profileDetail/BotManageView"
import "./index.css"

/**
 * BotManage —— 独立「Bot 管理」模块（octo-web#235 / YUJ-2838）。
 *
 * 三级导航：
 *   L1 BotDetailModal（既有）──兄弟 WKModal──▶ L2 BotManageModal（本文件）
 *   L2 BotManageView ──模块内 RoutePage.push──▶ L3 MentionFreeListView
 *
 * L1→L2 走「兄弟 WKModal」（仿 ClawInfoModal 在 BotDetailModal:785-790 的渲染方式），
 * 而不是嵌套；L2↔L3 走模块自带的 RoutePage + push（仿 PersonaSettings standalone
 * index.tsx:73-86），整条 L2/L3 共用 RoutePage 唯一一个返回箭头：
 *   - L2（栈空）时点 ← = onClose 关闭整个 BotManageModal；
 *   - L3（栈深 1）时点 ← = pop 回 L2 菜单。
 *
 * 与 PersonaSettings 的区别：PersonaSettings 既支持「嵌入父 RouteContext」也支持
 * 「standalone 自带 RoutePage」两种模式（YUJ-1435 双 ← 修复）。BotManage 永远是
 * 被 BotDetailModal 以「兄弟 WKModal」打开的独立模态，没有父 RouteContext，所以
 * 只保留 standalone 一种形态，心智更简单。
 *
 * VM 设计：MentionFreeVM 持有 robotId + 群列表状态，在 Provider 里创建一次。
 * robotId 变化（BotStore/GlobalSearch 复用同一 BotDetailModal 实例切 bot）时通过
 * setRobotId 重置并重拉，配合 VM 内 requestedUid/isStale 防串台（issue「注意 2」）。
 */
export interface BotManageModalProps {
    /** 被管理的 bot uid（= robot_id）。 */
    robotId: string
    visible: boolean
    onClose: () => void
}

export default class BotManageModal extends Component<BotManageModalProps> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    /** 持有 VM 引用以便在 robotId 变化时调用 setRobotId（防串台）。 */
    private vm?: MentionFreeVM

    /**
     * L3「卡片消息设置」的 VM。
     *
     * 不走 Provider（Provider 只托管一个 listener，已被 MentionFreeVM 占用），
     * 而是在这里持有 + 由 CardSettingsContainer 通过 addListener 订阅。
     *
     * 它在 L2 就被创建并拉一次目录（见 probeCardSettings）：这次请求既是「该 bot
     * 支不支持卡片设置」的能力探测（决定 L2 菜单要不要渲染这一行），也是 L3 首屏
     * 要用的数据，所以不是额外开销 —— L3 进页时若已有数据就不再重复请求。
     */
    private cardSettingsVM?: BotCardSettingsVM

    /** L2 菜单需要在能力探测出结果后重渲染，这里持有取消订阅句柄。 */
    private cardSettingsUnsubscribe?: () => void

    componentDidMount(): void {
        if (this.props.visible) this.probeCardSettings()
    }

    componentDidUpdate(prevProps: BotManageModalProps): void {
        const robotChanged = prevProps.robotId !== this.props.robotId
        if (robotChanged) {
            // bot 切换：复用同一 modal 实例时（BotStore 列表里点不同 bot），
            // 必须把 VM 切到新 robotId 并重拉，否则会看到上一个 bot 的群。
            if (this.vm) this.vm.setRobotId(this.props.robotId)
            if (this.props.visible) {
                if (this.cardSettingsVM) {
                    // setRobotId 内部会重拉，等价于对新 bot 重新探测。
                    this.cardSettingsVM.setRobotId(this.props.robotId)
                } else {
                    this.probeCardSettings()
                }
            } else {
                // 不可见时**不能**顺手 setRobotId —— 它会无条件重拉，于是「翻一张
                // 资料卡就发一个限流 GET」，正是下面那句注释想避免的事。直接丢掉 VM，
                // 下次打开重新创建 + 探测，天然拿到新 bot 的数据。
                this.disposeCardSettingsVM()
            }
            return
        }
        // 本组件跟着资料卡一起挂载（不是打开时才挂载），所以探测挂在 visible
        // 由假转真上，避免只是看了眼资料卡就发请求。
        if (!prevProps.visible && this.props.visible) {
            this.probeCardSettings()
        }
    }

    componentWillUnmount(): void {
        this.disposeCardSettingsVM()
    }

    /**
     * 每次打开都重新拉一次卡片设置目录：既判断这一行菜单要不要出现，也作为 L3 首屏
     * 的数据。
     *
     * **不能用 `hasData` 做守卫。** 本组件是常驻挂载、`visible` 切换的（`BotDetailModal`
     * 又是 BotStore / GlobalSearch 的常驻子组件），VM 会跨开关存活；用 `hasData`
     * 守卫会导致第二次打开一个请求都不发，等于把读接口的 `Cache-Control: private,
     * no-store` 缓存掉 —— 别处改的覆盖、别的设备改的、翻转过的部署总闸都会一直陈旧。
     *
     * 只有拿到 `err.server.robot.not_found`（该 bot 没有 robot 记录，App Bot 属于
     * 这一类）才隐藏菜单行。其余错误一律保持显示 —— 服务端抖动 / 限流 / 后端未部署
     * 都不代表这个 bot 永久不支持，藏掉入口会让用户以为功能消失了。
     */
    private probeCardSettings(): void {
        const vm = this.ensureCardSettingsVM()
        if (!vm.loading) void vm.loadSettings()
    }

    private ensureCardSettingsVM(): BotCardSettingsVM {
        if (!this.cardSettingsVM) {
            this.cardSettingsVM = new BotCardSettingsVM(this.props.robotId)
            this.cardSettingsUnsubscribe = this.cardSettingsVM.addListener(() =>
                this.forceUpdate(),
            )
        }
        return this.cardSettingsVM
    }

    private disposeCardSettingsVM(): void {
        if (this.cardSettingsUnsubscribe) this.cardSettingsUnsubscribe()
        this.cardSettingsUnsubscribe = undefined
        this.cardSettingsVM = undefined
    }

    render(): ReactNode {
        const { robotId, visible, onClose } = this.props
        const { t } = this.context
        const labels = this.createLabels()
        return (
            <WKModal
                title={null}
                visible={visible}
                onCancel={onClose}
                className="wk-bot-manage-modal"
                zIndex={1100}
                options={{ closable: false }}
            >
                <Provider
                    create={(): IProviderListener => {
                        this.vm = new MentionFreeVM(robotId)
                        return this.vm
                    }}
                    render={(vm: MentionFreeVM): ReactNode => (
                        <RoutePage
                            title={t("base.botManage.title")}
                            onClose={onClose}
                            render={(context: RouteContext<any>): ReactNode => (
                                <BotManageView
                                    labels={labels}
                                    // App Bot 等没有 robot 记录的 bot 不渲染这一行。
                                    showCardSettings={
                                        !this.cardSettingsVM?.isUnsupported
                                    }
                                    onOpenMentionFree={() => {
                                        context.push(
                                            <MentionFreeListContainer
                                                vm={vm}
                                                labels={labels}
                                                toggleFailedFallback={t(
                                                    "base.botManage.mentionFree.toggleFailed",
                                                )}
                                            />,
                                            new RouteContextConfig({
                                                title: t(
                                                    "base.botManage.mentionFree.title",
                                                ),
                                            }),
                                        )
                                    }}
                                    onOpenCardSettings={() => {
                                        context.push(
                                            <CardSettingsContainer
                                                vm={this.ensureCardSettingsVM()}
                                                labels={this.createCardLabels()}
                                            />,
                                            new RouteContextConfig({
                                                title: t(
                                                    "base.botManage.cardSettings.title",
                                                ),
                                            }),
                                        )
                                    }}
                                />
                            )}
                        />
                    )}
                />
            </WKModal>
        )
    }

    private createLabels(): BotManageViewLabels {
        const { t } = this.context
        return {
            mentionFree: t("base.botManage.menu.mentionFree"),
            mentionFreeHint: t("base.botManage.menu.mentionFreeHint"),
            cardSettings: t("base.botManage.menu.cardSettings"),
            cardSettingsHint: t("base.botManage.menu.cardSettingsHint"),
            autoApprove: t("base.botManage.menu.autoApprove"),
            autoApproveHint: t("base.botManage.menu.autoApproveHint"),
            profileCommands: t("base.botManage.menu.profileCommands"),
            profileCommandsHint: t("base.botManage.menu.profileCommandsHint"),
            comingSoon: t("base.botManage.comingSoon"),
            loading: t("base.botManage.loading"),
            backendComingSoon: t("base.botManage.backendComingSoon"),
            stayTuned: t("base.botManage.stayTuned"),
            loadFailed: t("base.botManage.loadFailed"),
            reload: t("base.botManage.reload"),
            searchPlaceholder: t("base.botManage.mentionFree.searchPlaceholder"),
            noSearchResult: t("base.botManage.mentionFree.noSearchResult"),
            empty: t("base.botManage.mentionFree.empty"),
            sectionEnabled: (count: number) =>
                t("base.botManage.mentionFree.sectionEnabled", {
                    values: { count },
                }),
            sectionOthers: t("base.botManage.mentionFree.sectionOthers"),
            rowOn: t("base.botManage.mentionFree.rowOn"),
            rowOff: t("base.botManage.mentionFree.rowOff"),
            rowBlocked: t("base.botManage.mentionFree.rowBlocked"),
        }
    }

    private createCardLabels(): BotCardSettingsLabels {
        const { t } = this.context
        return {
            rowTitle: {
                [BOT_CARD_DISPLAY_KEY]: t("base.botManage.cardSettings.display"),
                [BOT_CARD_INTERACTION_KEY]: t(
                    "base.botManage.cardSettings.interaction",
                ),
                [BOT_CARD_REASONING_KEY]: t(
                    "base.botManage.cardSettings.reasoning",
                ),
            },
            rowDesc: {
                [BOT_CARD_DISPLAY_KEY]: t(
                    "base.botManage.cardSettings.displayHint",
                ),
                [BOT_CARD_INTERACTION_KEY]: t(
                    "base.botManage.cardSettings.interactionHint",
                ),
                [BOT_CARD_REASONING_KEY]: t(
                    "base.botManage.cardSettings.reasoningHint",
                ),
            },
            masterLabel: t("base.botManage.cardSettings.masterLabel"),
            masterOn: t("base.botManage.cardSettings.masterOn"),
            masterOffValue: t("base.botManage.cardSettings.masterOffValue"),
            masterReadonly: t("base.botManage.cardSettings.masterReadonly"),
            masterOffNotice: t("base.botManage.cardSettings.masterOff"),
            needsDisplayNotice: t("base.botManage.cardSettings.needsDisplay"),
            sourceBot: t("base.botManage.cardSettings.sourceBot"),
            sourceDefault: t("base.botManage.cardSettings.sourceDefault"),
            sourceEnv: t("base.botManage.cardSettings.sourceEnv"),
            reset: t("base.botManage.cardSettings.reset"),
            loading: t("base.botManage.loading"),
            loadFailed: t("base.botManage.loadFailed"),
            reload: t("base.botManage.reload"),
            // 用卡片设置自己的「即将上线」文案，而不是复用 botManage 那条 ——
            // 复用会在这一页显示「Bot 管理功能即将上线」，让用户以为整个 Bot 管理
            // 都没上线，而其实只有卡片设置这组端点缺失（免@回答仍然可用）。
            backendComingSoon: t(
                "base.botManage.cardSettings.backendComingSoon",
            ),
            stayTuned: t("base.botManage.stayTuned"),
            unsupported: t("base.botManage.cardSettings.unsupported"),
            forbidden: t("base.botManage.cardSettings.forbidden"),
            empty: t("base.botManage.cardSettings.empty"),
            saveFailed: t("base.botManage.cardSettings.saveFailed"),
            saveFailedRetryable: t(
                "base.botManage.cardSettings.saveFailedRetryable",
            ),
            rateLimited: t("base.botManage.cardSettings.rateLimited"),
        }
    }
}

export { BotManageModal }
export { MentionFreeVM } from "../../bridge/profileDetail/BotManageVM"
export type { BotGroupItem } from "../../bridge/profileDetail/BotManageVM"
export { BotCardSettingsVM } from "../../bridge/profileDetail/BotCardSettingsVM"

interface CardSettingsContainerProps {
    vm: BotCardSettingsVM
    labels: BotCardSettingsLabels
}

/**
 * L3「卡片消息设置」容器。
 *
 * 打开 Bot 管理时（probeCardSettings）已经拉过一次目录，所以这里只在还没有数据时
 * 补拉：同一次打开里不发两个请求（这几个端点带按登录用户的限流），而"每次打开一次
 * 新鲜读取"由 probeCardSettings 保证。探测失败时 hasData 为 false，进这一页会顺带
 * 重试一次。
 */
class CardSettingsContainer extends Component<CardSettingsContainerProps> {
    private unsubscribe?: () => void

    componentDidMount(): void {
        const { vm } = this.props
        this.unsubscribe = vm.addListener(() => this.forceUpdate())
        if (!vm.hasData && !vm.loading) void vm.loadSettings()
    }

    componentWillUnmount(): void {
        if (this.unsubscribe) this.unsubscribe()
    }

    render(): ReactNode {
        const { vm, labels } = this.props
        const { rows, masterEnabled } = vm.snapshot()
        return (
            <CardSettingsView
                labels={labels}
                rows={rows}
                masterEnabled={masterEnabled}
                loading={vm.loading}
                hasData={vm.hasData}
                loadErrorKind={vm.loadError?.kind}
                writeErrorKind={vm.writeError?.kind}
                onToggle={(key, next) => vm.toggle(key, next)}
                onReset={(key) => void vm.resetToDefault(key)}
                onReload={() => vm.reload()}
            />
        )
    }
}

interface MentionFreeListContainerProps {
    vm: MentionFreeVM
    labels: BotManageViewLabels
    toggleFailedFallback: string
}

class MentionFreeListContainer extends Component<MentionFreeListContainerProps> {
    private unsubscribe?: () => void

    componentDidMount(): void {
        const { vm } = this.props
        this.unsubscribe = vm.addListener(() => this.forceUpdate())
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

    render(): ReactNode {
        const { vm, labels } = this.props
        const { enabled, others } = vm.visibleGroups()
        return (
            <MentionFreeListView
                labels={labels}
                loading={vm.loading}
                backendMissing={vm.isBackendMissing}
                loadError={vm.loadError}
                searchKeyword={vm.searchKeyword}
                enabledGroups={enabled.map(mapGroupItem)}
                otherGroups={others.map(mapGroupItem)}
                loadingMore={vm.loadingMore}
                onSearchKeywordChange={(value) => vm.setSearchKeyword(value)}
                onReload={() => void vm.loadGroups()}
                onLoadMore={() => void vm.loadMore()}
                onToggleMentionFree={(groupNo, next, ctx) => {
                    if (ctx) ctx.loading = true
                    void vm
                        .toggleMentionFree(groupNo, next)
                        .then((ok) => {
                            if (!ok && vm.toggleFailed) {
                                Toast.error(
                                    vm.toggleErrorMessage ||
                                        this.props.toggleFailedFallback,
                                )
                            }
                        })
                        .finally(() => {
                            if (ctx) ctx.loading = false
                        })
                }}
            />
        )
    }
}

function mapGroupItem(group: {
    group_no: string
    name: string
    no_mention: boolean
}): BotManageGroupItem {
    return {
        groupNo: group.group_no,
        name: group.name,
        noMention: group.no_mention,
    }
}
