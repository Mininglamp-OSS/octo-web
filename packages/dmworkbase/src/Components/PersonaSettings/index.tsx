import React, { Component, ReactNode } from "react"
import RouteContext from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import RoutePage from "../RoutePage"
import { MyBot, OboGrant, PersonaSettingsVM } from "./vm"
import PersonaEdit from "./PersonaEdit"
import "./index.css"

/**
 * PersonaSettings —— 「我的分身」主页面（PR-C/§7.2）。
 *
 * 入口路径：MeInfo → 「我的分身」Section → 点击 Row 推入本页（详见 MeInfo/vm.tsx）。
 * 内嵌一个 RoutePage 是为了复用 RouteContext 的 push / pop 栈，
 * 子页面（PersonaCreate / PersonaEdit）都通过 context.push 推入而不开新 RoutePage，
 * 否则会嵌套两层 header，移动端 back 行为会错位。
 *
 * 列表 cards 故意复用 BotStore 同款视觉：
 *   - 容器: rounded card, 同样的阴影/边距
 *   - 头像: 渐变色块, 首字母 fallback（统一了 bot/persona 视觉语言）
 *   - 命名空间用 `.wk-persona-*` 避免污染 BotStore 类名
 */
interface PersonaSettingsProps {
    /**
     * 可选 onClose：从 MeInfo 内 push 进来时 RoutePage 会自动用栈 pop 回上一页，
     * 不需要外部 close。但被独立作为模态打开时（譬如未来的 settings panel 链路）
     * 仍需要 close 钩子。两者兼容：未传 onClose 时复用 MeInfo 提供的栈即可。
     */
    onClose?: () => void
}

export default class PersonaSettings extends Component<PersonaSettingsProps> {
    render(): ReactNode {
        return (
            <Provider
                create={(): IProviderListener => new PersonaSettingsVM()}
                render={(vm: PersonaSettingsVM): ReactNode => {
                    return (
                        <RoutePage
                            title="我的分身"
                            onClose={() => {
                                if (this.props.onClose) this.props.onClose()
                            }}
                            render={(context: RouteContext<any>): ReactNode => {
                                return <PersonaListBody vm={vm} routeContext={context} />
                            }}
                        />
                    )
                }}
            />
        )
    }
}

/**
 * 列表 body —— 抽出来是为了让 PersonaListBody 在 vm.notifyListener() 后能感知到。
 * RouteContext 不参与 Provider 的渲染节流（Provider 的 render prop 才会订阅 vm），
 * 所以我们把 routeContext 透传给 body, body 再用 vm 渲染。
 */
function PersonaListBody(props: { vm: PersonaSettingsVM; routeContext: RouteContext<any> }) {
    const { vm, routeContext } = props
    const handleCreate = () => {
        // 进入「选择 bot」子页：复用 RouteContext.push, 与 MeInfo 同款交互
        routeContext.push(
            <PersonaCreate
                vm={vm}
                onCreated={async (botUid) => {
                    const grant = await vm.createGrant(botUid)
                    if (grant) {
                        // 创建后 pop 回列表 → 再 push 进 edit 让用户继续配 scope。
                        routeContext.pop()
                        routeContext.push(
                            <PersonaEdit
                                grant={grant}
                                onDeleted={() => {
                                    routeContext.pop()
                                    void vm.loadGrants()
                                }}
                                onChange={() => void vm.loadGrants()}
                            />,
                        )
                    }
                }}
            />,
        )
    }

    return (
        <div className="wk-persona-page">
            <div className="wk-persona-actions">
                <button
                    className="wk-persona-add-btn"
                    onClick={handleCreate}
                    disabled={vm.loading}
                >
                    + 新建分身
                </button>
            </div>

            {vm.loading && (
                <div className="wk-persona-loading">加载中...</div>
            )}

            {/* 后端 404（PR-A 尚未 merge）→ 不报错, 用「即将上线」文案 */}
            {!vm.loading && vm.isBackendMissing && (
                <div className="wk-persona-empty">
                    分身功能即将上线
                    <br />
                    敬请期待 ✨
                </div>
            )}

            {/* 其他网络/服务端错误 → 显示重试按钮 */}
            {!vm.loading && vm.loadError && !vm.isBackendMissing && (
                <div className="wk-persona-error">
                    加载失败
                    <div
                        className="wk-persona-error-retry"
                        onClick={() => void vm.loadGrants()}
                    >
                        重新加载
                    </div>
                </div>
            )}

            {/* 正常空态 */}
            {!vm.loading &&
                !vm.isBackendMissing &&
                !vm.loadError &&
                vm.grants.length === 0 && (
                    <div className="wk-persona-empty">
                        还没有创建任何分身
                        <br />
                        点击上方「新建分身」开始
                    </div>
                )}

            {/* 列表 */}
            <div className="wk-persona-list">
                {vm.grants.map((g) => (
                    <PersonaCard
                        key={g.id}
                        grant={g}
                        onClick={() => {
                            routeContext.push(
                                <PersonaEdit
                                    grant={g}
                                    onDeleted={() => {
                                        routeContext.pop()
                                        void vm.loadGrants()
                                    }}
                                    onChange={() => void vm.loadGrants()}
                                />,
                            )
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

/**
 * 卡片复用 BotStore 视觉：渐变头像 + 标题+badge + 副标题 + 状态点。
 * 不直接复用 BotStore/index.tsx 的 renderBotCard，是因为它带 BotInfo 专有的
 * `创建者` / `添加状态` 字段，对 persona 场景无意义。
 */
function PersonaCard(props: { grant: OboGrant; onClick: () => void }) {
    const { grant, onClick } = props
    const name = grant.grantee_bot_name || grant.grantee_bot_uid
    const initial = (name || "P").charAt(0).toUpperCase()
    const enabled = grant.active && grant.global_enabled
    return (
        <div className="wk-persona-card" onClick={onClick}>
            <div className="wk-persona-card-header">
                <div className="wk-persona-card-avatar">{initial}</div>
                <div className="wk-persona-card-info">
                    <div className="wk-persona-card-name">
                        {name}
                        <span className="wk-persona-card-name-badge">分身</span>
                    </div>
                    <div className="wk-persona-card-sub">
                        模式: {grant.mode === "draft" ? "草稿审批" : "自动回复"}
                    </div>
                </div>
                <span
                    className={`wk-persona-card-status ${enabled ? "on" : "off"}`}
                >
                    {enabled ? "● 启用" : "○ 关闭"}
                </span>
            </div>
        </div>
    )
}

/**
 * PersonaCreate —— bot 选择子页。从 vm.loadMyBots() 拉可用 bot 列表 + 过滤已绑定。
 * UX 简化：单击 bot 即创建，不再二次确认 —— 错误可在 PersonaEdit 里删除。
 */
function PersonaCreate(props: {
    vm: PersonaSettingsVM
    onCreated: (botUid: string) => void
}) {
    const { vm, onCreated } = props
    // 第一次渲染时触发 loadMyBots（避免在 vm 构造里副作用）
    React.useEffect(() => {
        if (vm.myBots.length === 0 && !vm.myBotsLoading) {
            void vm.loadMyBots()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
        <div className="wk-persona-create">
            {vm.myBotsLoading && (
                <div className="wk-persona-loading">加载中...</div>
            )}
            {!vm.myBotsLoading && vm.myBots.length === 0 && (
                <div className="wk-persona-empty">
                    暂无可关联的 Bot
                    <br />
                    请先去 AI 广场添加一个 bot
                </div>
            )}
            {vm.myBots.map((b: MyBot) => (
                <div
                    key={b.uid}
                    className="wk-persona-create-row"
                    onClick={() => onCreated(b.uid)}
                >
                    <div>
                        <div className="wk-persona-create-row-name">{b.name}</div>
                        <div className="wk-persona-create-row-sub">{b.uid}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

// 重导出，方便测试和外部引用
export { PersonaSettings }
export { PersonaSettingsVM, PersonaEditVM, hasAnyActiveGrant, refreshActiveGrantCache, clearPersonaActiveCache } from "./vm"
