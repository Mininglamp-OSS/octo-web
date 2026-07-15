import React, { Component, ReactNode } from "react"
import RouteContext, { RouteContextConfig } from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import WKModal from "../WKModal"
import RoutePage from "../RoutePage"
import { MentionFreeVM } from "./vm"
import BotManageMenu from "./BotManageMenu"
import MentionFreeList from "./MentionFreeList"
import { I18nContext } from "../../i18n"
import "./index.css"

/**
 * BotManage —— 独立「Bot 管理」模块（octo-web#235 / YUJ-2838）。
 *
 * 三级导航：
 *   L1 BotDetailModal（既有）──兄弟 WKModal──▶ L2 BotManageModal（本文件）
 *   L2 BotManageMenu ──模块内 RoutePage.push──▶ L3 MentionFreeList
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

    componentDidUpdate(prevProps: BotManageModalProps): void {
        // bot 切换：复用同一 modal 实例时（BotStore 列表里点不同 bot），
        // 必须把 VM 切到新 robotId 并重拉，否则会看到上一个 bot 的群。
        if (prevProps.robotId !== this.props.robotId && this.vm) {
            this.vm.setRobotId(this.props.robotId)
        }
    }

    render(): ReactNode {
        const { robotId, visible, onClose } = this.props
        const { t } = this.context
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
                                <BotManageMenu
                                    onOpenMentionFree={() => {
                                        context.push(
                                            <MentionFreeList vm={vm} />,
                                            new RouteContextConfig({
                                                title: t("base.botManage.mentionFree.title"),
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
}

export { BotManageModal }
export { MentionFreeVM } from "./vm"
export type { BotGroupItem } from "./vm"
