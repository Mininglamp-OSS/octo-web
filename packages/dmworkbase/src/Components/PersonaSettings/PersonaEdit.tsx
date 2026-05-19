import React, { Component, ReactNode } from "react"
import RouteContext from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import { Switch, Toast } from "@douyinfe/semi-ui"
import { OboGrant, PersonaEditVM } from "./vm"

/**
 * PersonaEdit — 单个 grant 的编辑页（mode + global toggle + scope 列表 + 删除）。
 *
 * 设计简化：v0 只支持 mode="auto"，UI 上只读展示「自动回复」一行，不给切换选项。
 * 等 v1 草稿模式上线再开关。global_enabled 是用户最常切的开关，单独 Switch 提供。
 *
 * scope 列表只展示当前已加入的 channel，**不**提供「添加 channel」入口 —— v0 设计
 * 是用户去具体 channel 的 ChannelSetting 里开/关 toggle 来管理 scope（详见
 * `ChannelSetting/vm.ts` 里的 OBO 注册块）。这里只允许「从列表里移除已加的」，
 * 把添加路径收敛到 ChannelSetting，避免双入口语义漂移（哪一边写赢？）。
 *
 * 删除走二次确认（Toast.warning + 二次点击 5s 内才生效），不弹 Modal —— RoutePage
 * 上下文里 Modal 在桌面/移动端表现不一致，详见 RoutePage 的 didMount 注释。
 */
interface PersonaEditProps {
    grant: OboGrant
    /**
     * 删除成功后，由调用方负责 pop 出本子页 + reload 上一层列表。
     */
    onDeleted: () => void
    /**
     * grant 字段（global_enabled / mode）发生持久化变化时回调，让父级
     * `PersonaSettingsVM.grants` 与服务端重新对齐。Round-2 review (Jerry-Xin)：
     * 之前在 PersonaEdit 改 global_enabled 后返回列表，PersonaCard 仍显示旧
     * `enabled` 状态，得重开页面才同步 —— 这里给父级一个回调让它 reload。
     */
    onChange?: () => void
}

interface PersonaEditState {
    confirmDelete: boolean
}

export default class PersonaEdit extends Component<PersonaEditProps, PersonaEditState> {
    state: PersonaEditState = { confirmDelete: false }
    private confirmTimer?: ReturnType<typeof setTimeout>

    componentWillUnmount() {
        if (this.confirmTimer) clearTimeout(this.confirmTimer)
    }

    /**
     * 第一次点 → state.confirmDelete=true + 5s 后自动复位 + Toast 提示再点一次确认。
     * 第二次点 → 真删除 + 调 onDeleted 回调。
     */
    private handleDelete = (vm: PersonaEditVM) => {
        if (!this.state.confirmDelete) {
            this.setState({ confirmDelete: true })
            Toast.warning("再次点击「删除分身」确认撤销")
            if (this.confirmTimer) clearTimeout(this.confirmTimer)
            this.confirmTimer = setTimeout(() => {
                this.setState({ confirmDelete: false })
            }, 5000)
            return
        }
        if (this.confirmTimer) clearTimeout(this.confirmTimer)
        void vm.deleteGrant().then((ok) => {
            if (ok) {
                this.props.onDeleted()
            } else {
                this.setState({ confirmDelete: false })
            }
        })
    }

    render(): ReactNode {
        const { grant } = this.props
        return (
            <Provider
                create={(): IProviderListener => new PersonaEditVM(grant)}
                render={(vm: PersonaEditVM): ReactNode => {
                    const showEmptyScope = !vm.loading && vm.scopes.length === 0
                    return (
                        <div className="wk-persona-edit">
                            {/* 基础信息 */}
                            <div className="wk-persona-edit-section">
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">关联 Bot</div>
                                    <div className="wk-persona-edit-row-value">
                                        {vm.grant.grantee_bot_name || vm.grant.grantee_bot_uid}
                                    </div>
                                </div>
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">模式</div>
                                    <div className="wk-persona-edit-row-value">
                                        {vm.grant.mode === "draft" ? "草稿审批" : "自动回复"}
                                    </div>
                                </div>
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">全局开关</div>
                                    <Switch
                                        checked={vm.grant.global_enabled}
                                        onChange={(v) => void vm.toggleGlobal(!!v).then((ok) => {
                                            if (ok && this.props.onChange) this.props.onChange()
                                        })}
                                    />
                                </div>
                            </div>

                            {/* Scope 列表 */}
                            <div className="wk-persona-edit-section">
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">
                                        生效会话 ({vm.scopes.length})
                                    </div>
                                </div>
                                <div className="wk-persona-edit-scope-list">
                                    {vm.loading && (
                                        <div className="wk-persona-edit-scope-empty">加载中...</div>
                                    )}
                                    {vm.isBackendMissing && (
                                        <div className="wk-persona-edit-scope-empty">
                                            分身功能即将上线
                                        </div>
                                    )}
                                    {vm.loadError && !vm.isBackendMissing && (
                                        <div className="wk-persona-edit-scope-empty">
                                            加载失败,请稍后再试
                                        </div>
                                    )}
                                    {showEmptyScope && !vm.isBackendMissing && !vm.loadError && (
                                        <div className="wk-persona-edit-scope-empty">
                                            尚未添加任何会话
                                            <br />
                                            请去具体会话的「设置 → 分身在此会话代答」开启
                                        </div>
                                    )}
                                    {vm.scopes.map((s) => (
                                        <div className="wk-persona-edit-scope-row" key={s.id}>
                                            <span>
                                                {s.channel_type === 2 ? "群聊" : "私聊"} · {s.channel_id}
                                            </span>
                                            <span
                                                className="wk-persona-edit-scope-remove"
                                                onClick={() => void vm.removeScope(s.id)}
                                            >
                                                移除
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 删除分身（二次确认） */}
                            <div
                                className="wk-persona-edit-danger"
                                onClick={() => this.handleDelete(vm)}
                            >
                                {this.state.confirmDelete ? "再次点击以确认删除" : "删除分身"}
                            </div>
                        </div>
                    )
                }}
            />
        )
    }
}

/**
 * PersonaEdit 的纯展示子组件（context 注入由 PersonaSettings/index.tsx 负责）。
 * 这里导出 Pure 是为了便于 v1 把页面嵌进非 RoutePage 容器（譬如 settings panel）。
 */
export { PersonaEditVM }
