import React, { Component, ReactNode } from "react"
import RouteContext from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import { Switch, Toast } from "@douyinfe/semi-ui"
import { OboGrant, OboScope, PersonaEditVM } from "./vm"

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
 *
 * R4 P1 (YUJ-1206 / GH octo-web#47 review 2026-05-19 07:38)：scope 列表必须按
 * `enabled` 分区显示，并让 remove 动作的文案与真实效果一致 —— 否则在 global=on
 * 模式下，把一条 `{enabled:false}` 排除记录展示成「生效会话」+「删除」按钮，会
 * 让用户以为「这里在替我代答」→ 点删除想停掉 → 实际删的是「排除条目」→ channel
 * 反而**重新被启用**，用户意图被反转。这是 on-behalf-of 类功能里最危险的反向
 * 操作，必须在 UI 层就消除歧义：
 *
 *   - 「包含」(`scope.enabled === true`)：当 global=off 时表示「分身在此处启用」，
 *     remove → 「停止代答」（落回 global=off 即关闭）。当 global=on 时该条记录
 *     与 global 重复（toggleOboScope 通常会自动 DELETE，但服务端历史数据可能残
 *     留），此时隐藏冗余条目避免噪声。
 *   - 「排除」(`scope.enabled === false`)：当 global=on 时表示「分身在此处静音」，
 *     remove → 「恢复代答」（落回 global=on 即启用）。当 global=off 时该条记录
 *     对生效集毫无贡献，此处直接隐藏避免误导用户。
 *
 * 测试覆盖见 `__tests__/PersonaEdit.test.tsx`。
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
    /**
     * v2 (octo-web#73)：表单本地状态。用 props.grant 做初值；用户在 textarea 里编辑
     * 时只更新 state，直到点「保存」才 PUT —— 避免每次 onChange 都打一次后端。
     * `active` 也走同样的本地态：用户切 toggle 后立即提交（active 是单一布尔，没有
     * 「半成品」状态需要先暂存），但保存按钮也允许把当前未保存的 prompt 与 active
     * 一次提交，便于「改 prompt 顺手切 active」的常见路径。
     */
    prompt: string
    active: boolean
    saving: boolean
}

export default class PersonaEdit extends Component<PersonaEditProps, PersonaEditState> {
    state: PersonaEditState = {
        confirmDelete: false,
        prompt: this.props.grant.persona_prompt || "",
        active: !!this.props.grant.active,
        saving: false,
    }
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

    /**
     * v2 (octo-web#73)：一次 PUT 提交 persona_prompt + active。
     * 成功后调父级 onChange 让 PersonaSettingsVM 重拉列表 —— 后端在 active=true 时会
     * mutex 其它 grant 的 active=false，本地这里看不见别人状态变化，必须 reload。
     */
    private handleSave = (vm: PersonaEditVM) => {
        if (this.state.saving) return
        this.setState({ saving: true })
        void vm
            .savePersonaForm(this.state.prompt, this.state.active)
            .then((ok) => {
                if (ok) {
                    Toast.success("已保存")
                    if (this.props.onChange) this.props.onChange()
                }
            })
            .finally(() => {
                this.setState({ saving: false })
            })
    }

    render(): ReactNode {
        const { grant } = this.props
        return (
            <Provider
                create={(): IProviderListener => new PersonaEditVM(grant)}
                render={(vm: PersonaEditVM): ReactNode => {
                    // R4 P1: 严格按 enabled 分区。global=on 时 inclusion 与 global 重复，
                    // 隐藏避免噪声；global=off 时 exclusion 对生效集无贡献，隐藏避免误导。
                    const globalOn = !!vm.grant.global_enabled
                    const inclusions: OboScope[] = vm.scopes.filter((s) => s.enabled !== false)
                    const exclusions: OboScope[] = vm.scopes.filter((s) => s.enabled === false)
                    const visibleScopes: OboScope[] = globalOn ? exclusions : inclusions
                    const showEmptyScope = !vm.loading && visibleScopes.length === 0
                    const sectionTitle = globalOn
                        ? `已排除的会话 (${exclusions.length})`
                        : `已启用的会话 (${inclusions.length})`
                    const emptyHint = globalOn
                        ? "暂无排除的会话\n请去具体会话的「设置 → 分身在此会话代答」关闭以将其排除"
                        : "尚未启用任何会话\n请去具体会话的「设置 → 分身在此会话代答」开启"
                    const removeLabel = globalOn ? "恢复代答" : "停止代答"
                    return (
                        <div className="wk-persona-edit">
                            {/* 基础信息 + v2 表单（octo-web#73）：
                                bot 名（只读）+ persona_prompt（可编辑）+ active toggle + 保存
                                布局复用 Create 表单视觉风格，让用户在两条路径上拿到一致的填写体验。 */}
                            <div className="wk-persona-edit-section">
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">关联 Bot</div>
                                    <div
                                        className="wk-persona-edit-row-value"
                                        data-testid="persona-edit-bot-name"
                                    >
                                        {vm.grant.grantee_bot_name || vm.grant.grantee_bot_uid}
                                    </div>
                                </div>
                                {/*
                                 * persona_prompt textarea：纵向占整行，与「关联 Bot」/「启用」
                                 * 的「左标题右值」横排不同，所以单独一个 column-row。
                                 * 用原生 textarea 与 PersonaCreate 保持一致（避免引入额外 Semi 组件
                                 * mock 噪音；Semi TextArea 在 RoutePage 容器里也偶发样式 portal 问题）。
                                 */}
                                <div className="wk-persona-edit-row wk-persona-edit-row-column">
                                    <div className="wk-persona-edit-row-title">回复风格 prompt</div>
                                    <textarea
                                        className="wk-persona-edit-prompt"
                                        placeholder="设置分身的回复风格，如：用简洁专业的语气回复"
                                        value={this.state.prompt}
                                        onChange={(e) =>
                                            this.setState({ prompt: e.target.value })
                                        }
                                        rows={4}
                                        data-testid="persona-edit-prompt"
                                    />
                                </div>
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">启用此分身</div>
                                    <div className="wk-persona-edit-row-control">
                                        {/*
                                         * v2 (octo-web#73)：active 是 mutex 字段，后端在 PUT
                                         * {active:true} 时会自动把同一用户其它 grant 的 active
                                         * 置 false。前端只 toggle 自己的状态，剩下的依赖
                                         * onChange → 父级 reload 把整列表拉回来对齐。
                                         */}
                                        <Switch
                                            checked={this.state.active}
                                            onChange={(v: boolean) =>
                                                this.setState({ active: !!v })
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="wk-persona-edit-row">
                                    <button
                                        className="wk-persona-edit-save-btn"
                                        disabled={this.state.saving}
                                        onClick={() => this.handleSave(vm)}
                                        data-testid="persona-edit-save"
                                    >
                                        {this.state.saving ? "保存中..." : "保存"}
                                    </button>
                                </div>
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">模式</div>
                                    <div className="wk-persona-edit-row-value">
                                        {vm.grant.mode === "draft" ? "草稿审批" : "自动回复"}
                                    </div>
                                </div>
                                <div className="wk-persona-edit-row">
                                    <div className="wk-persona-edit-row-title">全局开关</div>
                                    {/*
                                     * BUG-2 fix (YUJ-1444, 2026-05-20)：Semi UI <Switch> 是裸 flex 子项时，
                                     * 浏览器对它应用默认 `flex-shrink: 1`，宽度可能被父行的 flex 算法压扁导致
                                     * 「关闭态半截显示」。PR #69 只在 row / section 层加了 `flex-shrink: 0`，
                                     * 但 Switch 自身仍可能被压缩；在这层包一个 `.wk-persona-edit-row-control`
                                     * 把 Switch 的最终尺寸锁定在自然宽高，并 align-items: center 保证它垂直居中
                                     * 在 56px 行内不被截。
                                     */}
                                    <div className="wk-persona-edit-row-control">
                                        <Switch
                                            checked={vm.grant.global_enabled}
                                            onChange={(v) => void vm.toggleGlobal(!!v).then((ok) => {
                                                if (ok && this.props.onChange) this.props.onChange()
                                            })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Scope 列表（按 enabled 分区，文案 + 动作随 global 状态切换） */}
                            <div className="wk-persona-edit-section">
                                <div className="wk-persona-edit-row">
                                    <div
                                        className="wk-persona-edit-row-title"
                                        data-testid="persona-edit-scope-title"
                                    >
                                        {sectionTitle}
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
                                            {emptyHint.split("\n").map((line, idx) => (
                                                <React.Fragment key={idx}>
                                                    {idx > 0 && <br />}
                                                    {line}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    )}
                                    {visibleScopes.map((s) => (
                                        <div
                                            className="wk-persona-edit-scope-row"
                                            key={s.id}
                                            data-testid={`persona-edit-scope-row-${s.id}`}
                                            data-scope-kind={
                                                s.enabled === false ? "exclusion" : "inclusion"
                                            }
                                        >
                                            <span>
                                                {s.channel_type === 2 ? "群聊" : "私聊"} · {s.channel_id}
                                            </span>
                                            <span
                                                className="wk-persona-edit-scope-remove"
                                                data-testid={`persona-edit-scope-remove-${s.id}`}
                                                onClick={() => void vm.removeScope(s.id)}
                                            >
                                                {removeLabel}
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
