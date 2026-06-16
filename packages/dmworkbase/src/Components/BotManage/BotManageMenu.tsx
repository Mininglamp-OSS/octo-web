import React, { Component, ReactNode } from "react"
import { ListItem } from "../ListItem"
import { I18nContext } from "../../i18n"

/**
 * BotManageMenu —— L2「Bot 管理」菜单（octo-web#235 / YUJ-2838）。
 *
 * 本期菜单项（issue）：
 *   - 💬 免@回答    可点 → push 进 L3 MentionFreeList
 *   - ✅ 自动通过    disabled 占位（本期不做）
 *   - ✏️ 简介指令    disabled 占位（本期不做）
 *
 * 用 dmworkbase 既有 ListItem（.wk-list-item）渲染。ListItem 内置右箭头被注释掉了
 * （见 ListItem/index.tsx:31-33），所以 chevron（›）自绘塞进 subTitle，用
 * .wk-list-chevron 承载（issue「注意 1」）。可点项给 onClick → ListItem 自动加
 * ripple + clickable 态；占位项不传 onClick → ListItem 走 static 态，再叠一层
 * .wk-bot-manage-menu-item-disabled 降低不透明度表达「即将上线」。
 */
export interface BotManageMenuProps {
    onOpenMentionFree: () => void
}

export default class BotManageMenu extends Component<BotManageMenuProps> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    render(): ReactNode {
        const { onOpenMentionFree } = this.props
        const { t } = this.context
        const chevron = <span className="wk-list-chevron">›</span>
        return (
            <div className="wk-bot-manage-page">
                <div className="wk-bot-manage-menu">
                    {/* 💬 免@回答 —— 本期唯一可点项 */}
                    <ListItem
                        style={{}}
                        title={t("base.botManage.menu.mentionFree")}
                        subTitle={chevron}
                        onClick={onOpenMentionFree}
                    />
                    {/* ✅ 自动通过 —— disabled 占位（不传 onClick → static） */}
                    <div className="wk-bot-manage-menu-item-disabled">
                        <ListItem
                            style={{}}
                            title={t("base.botManage.menu.autoApprove")}
                            subTitle={
                                <span className="wk-list-chevron">
                                    {t("base.botManage.comingSoon")}
                                </span>
                            }
                        />
                    </div>
                    {/* ✏️ 简介指令 —— disabled 占位 */}
                    <div className="wk-bot-manage-menu-item-disabled">
                        <ListItem
                            style={{}}
                            title={t("base.botManage.menu.profileCommands")}
                            subTitle={
                                <span className="wk-list-chevron">
                                    {t("base.botManage.comingSoon")}
                                </span>
                            }
                        />
                    </div>
                </div>
            </div>
        )
    }
}

export { BotManageMenu }
