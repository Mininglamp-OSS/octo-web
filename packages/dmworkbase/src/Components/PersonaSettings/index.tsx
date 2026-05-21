import React, { Component, ReactNode } from "react"
import RouteContext from "../../Service/Context"
import Provider, { IProviderListener } from "../../Service/Provider"
import { Switch } from "@douyinfe/semi-ui"
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
    /**
     * BUG-FIX (YUJ-1435, 2026-05-20)：当 PersonaSettings 是被父级 RouteContext
     * （例如 MeInfo 的 RoutePage）`push` 进来时，父级已经在顶部渲染了一个 header +
     * back arrow。若 PersonaSettings 内部再嵌一层 `RoutePage`，用户会看到两个
     * 叠加的 ← 返回按钮（P1 视觉 bug）。
     *
     * 修复策略：当父级把它的 RouteContext 透传进来（`routeContext` 非 undefined），
     * 本组件不再创建嵌套 RoutePage —— 直接把 PersonaCreate / PersonaEdit 子页面
     * push 到父级的 stack 上，由父级唯一的 back arrow 统一管理「PersonaEdit →
     * 分身列表 → MeInfo」整条路径的回退。这同时也消除了「点 PersonaEdit 上的
     * outer back 直接关掉整个 PersonaSettings 跳过列表」的奇怪 UX（原因：outer
     * back 弹的是父 stack 顶，而内部子页之前在 inner stack）。
     *
     * 当 `routeContext` 未传（独立测试 / 未来 settings panel 链路）时仍保留旧的
     * 内嵌 RoutePage 行为，保证向后兼容。`PersonaSettings.test.tsx` 走的就是这条
     * 路径，render(<PersonaSettings />) 不传 routeContext。
     */
    routeContext?: RouteContext<any>
}

export default class PersonaSettings extends Component<PersonaSettingsProps> {
    render(): ReactNode {
        return (
            <Provider
                create={(): IProviderListener => new PersonaSettingsVM()}
                render={(vm: PersonaSettingsVM): ReactNode => {
                    // 嵌入模式（YUJ-1435）：父级已提供 header + back arrow，
                    // 直接渲染 body 并复用父级 RouteContext，避免双 ← 按钮。
                    if (this.props.routeContext) {
                        return (
                            <PersonaListBody
                                vm={vm}
                                routeContext={this.props.routeContext}
                            />
                        )
                    }
                    // 独立模式：维持旧行为，自带 RoutePage（向后兼容 / 测试 / 模态化场景）。
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
 *
 * BUG-1 fix (YUJ-1341, 2026-05-19)：之前只依赖 `PersonaSettingsVM.didMount()` 走
 * `Provider.componentDidMount` 这条链来触发 `loadGrants()`。E2E 实测发现 grant
 * 已存在 (id=1, active=1) 时列表仍渲染「还没有创建任何分身」—— 根因是 VM 端的
 * `didMount` 触发链在 `Provider` 重渲染、StrictMode 双 mount、或父级 WKViewQueue
 * push 期间不够稳：第一帧 PersonaListBody 已经用初值 `grants=[]` 渲染了「还没有
 * 创建任何分身」空态，而 Provider.componentDidMount 才在之后跑 didMount → loadGrants,
 * 中间任何一次 setState 没把后续的 notifyListener 接回 DOM，列表就永远停在空态。
 *
 * 解决：把 PersonaListBody 改成一个最小 class 组件，在 `componentDidMount` 里显式
 * 自拉一次 grants（带 `vm.loading` 守卫与「已加载/已错」守卫，避免与 VM 的 didMount
 * 重复 GET）。视图层自己保证「至少触发过一次」语义，不再依赖 Provider/ProviderListener
 * 的隐式生命周期。组件保持 class 形态（而非 hooks）是因为 dmworkbase 仍是 React 17，
 * 与 testing-library/react 18 同时存在时 hook 会报 "Invalid hook call"。
 */
interface PersonaListBodyProps {
    vm: PersonaSettingsVM
    routeContext: RouteContext<any>
}

class PersonaListBody extends Component<PersonaListBodyProps> {
    componentDidMount(): void {
        const { vm } = this.props
        // 与 VM.didMount 的 loadGrants 重复触发是无害的（最坏多一次 GET，且第二次
        // 会被 loading 守卫挡掉），但「至少一次」是必须的：当 Provider 链路因任何
        // 原因没把 VM.didMount 拉起来时，这里兜底。
        const alreadyLoaded =
            vm.grants.length > 0 || vm.loadError || vm.isBackendMissing
        if (!vm.loading && !alreadyLoaded) {
            void vm.loadGrants()
        }
    }

    private handleCreate = (): void => {
        const { vm, routeContext } = this.props
        // 进入「选择 bot」子页：复用 RouteContext.push, 与 MeInfo 同款交互
        routeContext.push(
            <PersonaCreate
                vm={vm}
                onCreated={async (botUid, personaPrompt) => {
                    // v2 (octo-web#73): persona_prompt 在创建时一并提交，省去创建后再
                    // 进 edit 补填的回合数。空串由 vm.createGrant 内部过滤掉，不会污染
                    // 后端的 NULL 默认。
                    const grant = await vm.createGrant(botUid, personaPrompt)
                    if (grant) {
                        // 创建后用 replace 一步切到 edit —— 不能用 pop()+push()。
                        // 历史教训 (YUJ-1348, 2026-05-19, Jerry-Xin review on 8145f420)：
                        // 旧实现在 onCreated 里同帧调 `routeContext.pop()` + `routeContext.push(<PersonaEdit/>)`。
                        // RoutePage.pop 只是把 status 改成 Pop 然后 setState 异步减 pushViewCount，
                        // 同帧紧接着的 push 又会读到陈旧的 `this.state.pushViewCount` 再 +1；
                        // WKViewQueue.pop 也得等动画结束才真正从 queues 里移除旧视图，
                        // push 的新视图被追加到旧 queue 末尾。结果栈从期望的 list→edit
                        // 错成 list→create→edit，从 edit 按返回会回到 create 选择器而不是
                        // 列表，header 状态也跟着错乱。replace 是 RouteContext 上为
                        // 「同位置换内容」语义专门加的原子操作，避免了上面整条 race。
                        routeContext.replace(
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

    render(): ReactNode {
        const { vm, routeContext } = this.props
        return (
            <div className="wk-persona-page">
                {/*
                 * R4 非阻塞 (YUJ-1206 / GH octo-web#47 review 2026-05-19)：后端 404 时
                 * 隐藏「新建分身」按钮 —— 它点击后会试图 POST /v1/obo/grants，结果只能
                 * 报 Toast 错误，与上面「分身功能即将上线」文案自相矛盾。
                 *
                 * YUJ-1348 非阻塞 (Jerry-Xin review on 8145f420)：通用 `loadError` 也
                 * 应隐藏 —— 列表没拉下来时用户对「已存在哪些 grant」是盲的，盲态下点
                 * 创建容易产生重复 grant（同一个 bot 被绑两次）。先让用户走「重新加载」
                 * 把列表拉回来，再让 add 按钮重新出现。
                 */}
                {!vm.isBackendMissing && !vm.loadError && (
                    <div className="wk-persona-actions">
                        <button
                            className="wk-persona-add-btn"
                            onClick={this.handleCreate}
                            disabled={vm.loading}
                        >
                            + 新建分身
                        </button>
                    </div>
                )}

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
                    {(() => {
                        // v2 (octo-web#73)：当有任意 grant active=true 时，把非 active 的卡片
                        // 视觉「dim」（降低不透明度）来强调「正在生效的只有这一个」。这与后端
                        // mutex（同一用户最多一个 active grant）的产品语义直接对应；用户切换
                        // 时也能立刻看出新的 active 行是谁。
                        const anyActive = vm.grants.some((g) => g.active)
                        return vm.grants.map((g) => (
                            <PersonaCard
                                key={g.id}
                                grant={g}
                                dimmed={anyActive && !g.active}
                                onToggle={async (next) => {
                                    // 后端在 PUT {active: true} 时自动 mutex 其它 grant，
                                    // updateGrant 已经会 reload 整列表 → 卡片 active 状态自动同步。
                                    await vm.updateGrant(g.id, { active: next })
                                }}
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
                        ))
                    })()}
                </div>
            </div>
        )
    }
}

/**
 * 卡片复用 BotStore 视觉：渐变头像 + 标题+badge + 副标题 + 右侧 active 开关。
 * 不直接复用 BotStore/index.tsx 的 renderBotCard，是因为它带 BotInfo 专有的
 * `创建者` / `添加状态` 字段，对 persona 场景无意义。
 *
 * v2 (octo-web#73)：
 *   - 右侧改为可点击的 Switch：开 → PUT {active: true}（后端 mutex 关其它），
 *     关 → PUT {active: false}。开关 click 事件 stopPropagation，避免冒泡触发卡片
 *     onClick 跳进 PersonaEdit。
 *   - `dimmed` 由父级根据「列表里是否有任意 active grant」计算；非 active 卡片
 *     opacity 调低，与 active 卡片形成对比，呼应「同一时刻只有一个生效」。
 */
function PersonaCard(props: {
    grant: OboGrant
    dimmed?: boolean
    onClick: () => void
    onToggle: (next: boolean) => Promise<void> | void
}) {
    const { grant, dimmed, onClick, onToggle } = props
    const name = grant.grantee_bot_name || grant.grantee_bot_uid
    const initial = (name || "P").charAt(0).toUpperCase()
    const cardClass =
        "wk-persona-card" +
        (grant.active ? " wk-persona-card-active" : "") +
        (dimmed ? " wk-persona-card-dimmed" : "")
    return (
        <div
            className={cardClass}
            onClick={onClick}
            data-testid={`persona-card-${grant.id}`}
            data-active={grant.active ? "1" : "0"}
        >
            <div className="wk-persona-card-header">
                <div className="wk-persona-card-avatar">{initial}</div>
                <div className="wk-persona-card-info">
                    <div className="wk-persona-card-name">
                        {name}
                        <span className="wk-persona-card-name-badge">分身</span>
                    </div>
                    <div className="wk-persona-card-sub">
                        {grant.persona_prompt && grant.persona_prompt.trim()
                            ? grant.persona_prompt
                            : "未设置回复风格"}
                    </div>
                </div>
                {/*
                 * 开关容器拦截 click：Semi Switch 的 onChange 会在 input click 之后触发，
                 * 但 click 还是会冒到外层 .wk-persona-card → onClick 把页面 push 到 Edit。
                 * 用一个 wrapper stopPropagation，让 toggle 与「点卡片打开编辑」两条交互
                 * 互不干扰；同时 Switch 的尺寸由 .wk-persona-card-toggle 锁定避免被压缩
                 * （与 PersonaEdit row-control 同款防御）。
                 */}
                <div
                    className="wk-persona-card-toggle"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`persona-card-toggle-${grant.id}`}
                >
                    <Switch
                        checked={!!grant.active}
                        onChange={(v: boolean) => void onToggle(!!v)}
                    />
                </div>
            </div>
        </div>
    )
}

/**
 * PersonaCreate —— bot 选择子页 + persona_prompt 表单（v2, octo-web#73）。
 *
 * 交互：
 *   1. 顶部一份「选择 bot」列表：点击某行 → 选中该 bot（高亮）。
 *   2. 选中后下方启用 `persona_prompt` textarea + 「创建分身」按钮；用户填好后点
 *      创建，触发 `onCreated(uid, prompt)`，由父级 `handleCreate` 走 createGrant
 *      → replace 到 PersonaEdit。
 *   3. 留空 prompt 也允许提交（创建无风格的 grant，等用户之后再补）。
 *
 * 设计取舍：
 *   - 仍保留「点 bot 即完成选择」的轻量手感，不让 UX 变成「先勾选再提交」两步表单；
 *     选中后下方表单原地展开。
 *   - textarea 用原生 `<textarea>`（不依赖 Semi `TextArea`）的两个原因：
 *     a) 现有 vm.test 已 mock semi-ui，引入更多 Semi 子组件会增加测试 mock 噪音；
 *     b) 这是设置子页里一段简单的多行输入，原生足够，少一层 Semi 主题/portal 包装
 *        在 RoutePage 容器里也更稳。
 */
function PersonaCreate(props: {
    vm: PersonaSettingsVM
    onCreated: (botUid: string, personaPrompt: string) => Promise<void> | void
}) {
    const { vm, onCreated } = props
    const [selectedUid, setSelectedUid] = React.useState<string>("")
    const [prompt, setPrompt] = React.useState<string>("")
    const [submitting, setSubmitting] = React.useState<boolean>(false)
    // 第一次渲染时触发 loadMyBots（避免在 vm 构造里副作用）
    React.useEffect(() => {
        if (vm.myBots.length === 0 && !vm.myBotsLoading) {
            void vm.loadMyBots()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const selectedBot = vm.myBots.find((b) => b.uid === selectedUid)
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
            {vm.myBots.map((b: MyBot) => {
                const active = b.uid === selectedUid
                return (
                    <div
                        key={b.uid}
                        className={
                            "wk-persona-create-row" +
                            (active ? " wk-persona-create-row-selected" : "")
                        }
                        onClick={() => setSelectedUid(b.uid)}
                        data-testid={`persona-create-bot-${b.uid}`}
                        data-selected={active ? "1" : "0"}
                    >
                        <div>
                            <div className="wk-persona-create-row-name">{b.name}</div>
                            <div className="wk-persona-create-row-sub">{b.uid}</div>
                        </div>
                    </div>
                )
            })}

            {/* v2 表单：选中 bot 后展开 prompt + 提交按钮 */}
            {selectedBot && (
                <div className="wk-persona-create-form">
                    <div className="wk-persona-create-form-label">
                        回复风格 prompt（可选）
                    </div>
                    <textarea
                        className="wk-persona-create-prompt"
                        placeholder="设置分身的回复风格，如：用简洁专业的语气回复"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={4}
                        data-testid="persona-create-prompt"
                    />
                    <button
                        className="wk-persona-add-btn"
                        disabled={submitting}
                        data-testid="persona-create-submit"
                        onClick={async () => {
                            if (submitting) return
                            setSubmitting(true)
                            try {
                                await onCreated(selectedBot.uid, prompt)
                            } finally {
                                setSubmitting(false)
                            }
                        }}
                    >
                        {submitting ? "创建中..." : "创建分身"}
                    </button>
                </div>
            )}
        </div>
    )
}

// 重导出，方便测试和外部引用
export { PersonaSettings }
export { PersonaSettingsVM, PersonaEditVM, hasAnyActiveGrant, refreshActiveGrantCache, clearPersonaActiveCache } from "./vm"
