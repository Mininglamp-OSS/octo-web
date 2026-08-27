import React from "react";
import WKSDK, { ConnectStatus } from "wukongimjssdk";
import type { IModule } from "@octo/base";
import { i18n, WKApp, Menus, t as translate, Dap } from "@octo/base";
import SummaryListPage from "./pages/SummaryListPage";
import SummaryCreatePage from "./pages/SummaryCreatePage";
import SummaryDetailPage from "./pages/SummaryDetailPage";
import SummaryShareDetailPage from "./pages/SummaryShareDetailPage";
import SummarySharePreviewFeature from "./features/summaryShare/SummarySharePreviewFeature";
import SummaryConfirmPage from "./pages/SummaryConfirmPage";
import ScheduleListPage from "./pages/ScheduleListPage";
import { getChatCandidates, getSummaryShare } from "./api/summaryApi";
import { getOriginalSummaryTaskId, shouldOpenOriginalSummary } from "./features/summaryShare/navigation";
import { notifyChatSummaryCreated } from "./utils/chatSummaryActions";
import { getSummaryAttentionBadge, readSummaryAttentionCount, refreshSummaryAttentionBadge, setSummaryAttentionBadge } from "./utils/summaryAttentionBadge";
import { createAttentionSync, shouldRefreshForMessage, type AttentionSync } from "./utils/summaryAttentionSync";
import { createAttentionPoll, type AttentionPoll } from "./utils/summaryAttentionPoll";
import { createAttentionLeader, type AttentionLeader } from "./utils/summaryAttentionLeader";
import { isSupportedChannelType } from "./utils/channelType";
import { SMALL_SCREEN_WIDTH } from "@octo/base/src/Components/WKLayout/layoutWidth";
import ChatSummaryStarButton from "./components/ChatSummaryStarButton";
import ChatSummaryPanel from "./components/ChatSummaryPanel";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

let _spaceChangedHandler: (() => void) | null = null;
let _spaceReadyHandler: (() => void) | null = null;
// 外部事件→红点同步。模块级单例，与上面两个 handler 同生命周期。
let _attentionSync: AttentionSync | null = null;
let _visibilityHandler: (() => void) | null = null;
let _focusHandler: (() => void) | null = null;
// 后台兜底轮询 + 跨标签页 leader 选举。与上面几个 handler 同生命周期，
// 它们持有真实的 setTimeout/setInterval，热更时必须一并拆掉。
let _attentionPoll: AttentionPoll | null = null;
let _attentionLeader: AttentionLeader | null = null;
let _menuActivatedHandler: (() => void) | null = null;
let _imMessageHandler: ((message: unknown) => void) | null = null;
let _imConnectHandler: ((status: unknown) => void) | null = null;
const openingSummaryShares = new Set<string>();
// NavRail 每次进入的序号：并入默认创建页元素的 key。key 若固定，重复点菜单时
// React 会复用旧实例（WKViewQueue 按数组下标渲染），「重置回默认创建页」不生效。
let summaryHomeEntrySeq = 0;

function afterSummaryMenuSwitch(action: () => void) {
    if (WKApp.switchToMenuById && WKApp.currentMenuId !== "summary") {
        WKApp.switchToMenuById("summary", action);
        return;
    }
    action();
}

/**
 * NavRail 顶层菜单图标（智能总结）。与 dmworkappbot 的菜单图标同构：
 * 纯 SVG、随 active 变色，不引入额外依赖。
 */
function SummaryMenuIcon(_props: { active?: boolean }) {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(0 1.66665)" fill="currentColor">
                <path d="M9.58333 0C8.89298 0 8.33333 0.559644 8.33333 1.25C8.33333 1.79426 8.68117 2.25727 9.16667 2.42887V4.16667H4.58333C3.66286 4.16667 2.91667 4.91286 2.91667 5.83333V15C2.91667 15.9205 3.66286 16.6667 4.58333 16.6667H15.4167C16.3371 16.6667 17.0833 15.9205 17.0833 15V5.83333C17.0833 4.91286 16.3371 4.16667 15.4167 4.16667H10.8333V2.42887C11.3188 2.25727 11.6667 1.79426 11.6667 1.25C11.6667 0.559644 11.107 0 10.4167 0H9.58333ZM5.83333 10.4167C5.83333 9.72631 6.39298 9.16667 7.08333 9.16667C7.77369 9.16667 8.33333 9.72631 8.33333 10.4167C8.33333 11.107 7.77369 11.6667 7.08333 11.6667C6.39298 11.6667 5.83333 11.107 5.83333 10.4167ZM12.9167 9.16667C13.607 9.16667 14.1667 9.72631 14.1667 10.4167C14.1667 11.107 13.607 11.6667 12.9167 11.6667C12.2263 11.6667 11.6667 11.107 11.6667 10.4167C11.6667 9.72631 12.2263 9.16667 12.9167 9.16667Z" />
                <path d="M1.66667 9.16667C1.66667 8.70643 1.29357 8.33333 0.833333 8.33333C0.373096 8.33333 0 8.70643 0 9.16667V11.6667C0 12.1269 0.373096 12.5 0.833333 12.5C1.29357 12.5 1.66667 12.1269 1.66667 11.6667V9.16667Z" />
                <path d="M19.1667 8.33333C18.7064 8.33333 18.3333 8.70643 18.3333 9.16667V11.6667C18.3333 12.1269 18.7064 12.5 19.1667 12.5C19.6269 12.5 20 12.1269 20 11.6667V9.16667C20 8.70643 19.6269 8.33333 19.1667 8.33333Z" />
            </g>
        </svg>
    );
}

export class SummaryModule implements IModule {
    id(): string {
        return "SummaryModule";
    }

    init(): void {
        i18n.registerNamespace("summary", {
            "zh-CN": zhCN,
            "en-US": enUS,
        });

        WKApp.openSummaryDetail = (taskId: number | string, spaceId, originChannel) => {
            afterSummaryMenuSwitch(() => {
                // 卡片深链带的空间可能≠当前空间，路由前先切目标空间，与浏览器路由 applyStandaloneSummarySpaceFromQuery 对称。
                if (spaceId) WKApp.shared.currentSpaceId = spaceId;
                WKApp.routeLeft.popToRoot();
                WKApp.routeRight.replaceToRoot(
                    <SummaryDetailPage taskId={taskId} originChannel={originChannel} emitSelection />
                );
            });
        };

        WKApp.openSummarySharePreview = (shareId, spaceId, originChannel) => {
            if (spaceId) WKApp.shared.currentSpaceId = spaceId;
            const close = () => WKApp.shared.baseContext.hideGlobalModal();
            WKApp.shared.baseContext.showGlobalModal({
                width: "800px",
                closable: false,
                footer: null,
                onCancel: close,
                body: <SummarySharePreviewFeature
                    shareId={shareId}
                    onClose={close}
                    onOpenDetail={() => {
                        close();
                        WKApp.openSummaryShareDetail?.(shareId, spaceId, originChannel);
                    }}
                />,
            });
        };

        WKApp.openSummaryShareDetail = async (shareId, spaceId, originChannel) => {
            if (openingSummaryShares.has(shareId)) return;
            openingSummaryShares.add(shareId);
            try {
                const share = await getSummaryShare(shareId, spaceId);
                if (shouldOpenOriginalSummary(share) && WKApp.openSummaryDetail) {
                    WKApp.openSummaryDetail(
                        getOriginalSummaryTaskId(share),
                        share.snapshot.space_id || spaceId,
                        originChannel,
                    );
                    return;
                }
            } catch {
                // Fall through to the shared page, which owns unavailable/error rendering.
            } finally {
                openingSummaryShares.delete(shareId);
            }

            afterSummaryMenuSwitch(() => {
                if (spaceId) WKApp.shared.currentSpaceId = spaceId;
                const query = spaceId ? `?sp=${encodeURIComponent(spaceId)}` : "";
                window.history.pushState({}, "", `/s/share/${encodeURIComponent(shareId)}${query}`);
                WKApp.routeLeft.popToRoot();
                WKApp.routeRight.replaceToRoot(
                    <SummaryShareDetailPage shareId={shareId} originChannel={originChannel} />
                );
            });
        };

        WKApp.route.register("/summary", () => {
            return <SummaryListPage />;
        });

        WKApp.route.register("/summary/create", () => {
            return <SummaryCreatePage source="summary_home" />;
        });

        // 详情页「继续优化」按钮 → 打开新的 chat + 预填引用。
        // 通过 window 事件与详情页解耦(避免循环导入),这里 addEventListener
        // 后统一走 WKApp.routeRight.push 弹出新的 SummaryCreatePage 实例。
        // 见 CHAT-REFERENCE-BASED-DESIGN-v1。
        window.addEventListener('summary-open-chat-with-reference', ((e: CustomEvent) => {
            const task = e.detail;
            if (!task || !task.task_id) return;
            WKApp.routeRight.push(<SummaryCreatePage derivedFromTask={task} source="detail_optimize" />);
        }) as EventListener);

        WKApp.route.register("/summary/detail", (param: any) => {
            return <SummaryDetailPage taskId={param?.taskId} emitSelection />;
        });

        WKApp.route.register("/summary/share", (param: any) => {
            return <SummaryShareDetailPage shareId={param?.shareId} />;
        });

        WKApp.route.register("/summary/confirm", (param: any) => {
            return <SummaryConfirmPage taskId={param?.taskId} />;
        });

        WKApp.route.register("/summary/schedules", () => {
            return <ScheduleListPage />;
        });

        // 顶层 NavRail 菜单入口（sort=4002，紧跟在 contacts=4000 之后）。
        // 背景：之前 summary 只挂了路由 + 聊天窗口星标按钮，没有顶层可见菜单，
        // 导致「多人协作 / 多人定时」入口在主导航上找不到。菜单 id 须为 "summary"，
        // 与 WKApp.switchToMenuById("summary") 及 SummaryListPage 监听的 wk:nav-menu-activated
        // (menuId === "summary") 保持一致；路由指向 /summary 列表页（列表页内「+」下拉选择
        // 总结方式：快速总结 / Agent 总结，进入对应创建页，可选参与者 + 定时）。
        WKApp.menus.register(
            "summary",
            () => {
                const menu = new Menus(
                    "summary",
                    "/summary",
                    translate("summary.menu.title"),
                    <SummaryMenuIcon />,
                    <SummaryMenuIcon active />,
                );
                // #1359 待关注红点（未读 ∪ 未处理邀请 ∪ 待提交）：badge 字段与 NavRail
                // 渲染已存在，此处每次 render 读最新计数即可（宿主 forceUpdate 驱动重绘）。
                menu.badge = getSummaryAttentionBadge();
                // 点击「总结」：主区 SummaryListPage 已由 MainContentLeft 按
                // currentMenus.routePath(/summary) 渲染（Menu 激活即挂载唯一实例）。
                // 右栏默认展示新建总结页（取代原先的欢迎占位页）——产品要求进入
                // 智能总结即落在创建页。注意只 replaceToRoot 创建页：列表页由
                // MainContentLeft 持有，往 routeRight 再推一份 /summary 会造成列表页
                // 双实例（#1461 e2e S1/S9/S11 strict mode violation 的教训）。
                menu.onPress = (reentry?: boolean) => {
                    // 埋点 290:从 NavRail「总结」顶层入口进入模块（隐私 props 恒空）。
                    // 重复点击已激活的总结菜单不计（reentry），宿主按 prevMenuId===id 传入（见二审 P2-4）。
                    if (!reentry) {
                        Dap.shared.track("smart_summary_module_entered", {});
                    }
                    WKApp.routeLeft.popToRoot();
                    if (window.innerWidth <= SMALL_SCREEN_WIDTH) {
                        // 小屏（≤640px）：WKLayout 把右栏渲染为盖住 NavRail 的 fixed 覆盖层
                        // （z-index 20 > 10），而创建页非面板模式没有返回控件——推入创建页
                        // 会困住用户。小屏保持原行为：落在列表，创建走「+」下拉。
                        WKApp.routeRight.popToRoot();
                        return;
                    }
                    WKApp.routeRight.replaceToRoot(
                        <SummaryCreatePage
                            source="summary_home"
                            key={`home-normal-${++summaryHomeEntrySeq}`}
                            initialMode="normal"
                        />
                    );
                };
                return menu;
            },
            4002,
        );

        let initialSpaceReady = false;
        _spaceChangedHandler = () => {
            WKApp.mittBus.emit('summary-space-changed');
            // Main 冷启动若修正了缓存 Space，会先发 space-changed 再发
            // space-ready；首刷统一交给 space-ready，避免同一次启动请求两次。
            if (!initialSpaceReady) return;
            // 先归零再拉：旧值属于上一个 Space，对新 Space 而言它是错的。若拉取
            // 失败（静默保持旧值），归零后的失败模式是“没红点”而不是“别人的红点”。
            // 计数现在含义比「未处理邀请」宽得多，显错 Space 的数字更具误导性。
            setSummaryAttentionBadge(0);
            refreshSummaryAttentionBadge();
            // 切 Space 是一次明确的用户活动：把轮询拉回基础档。否则上一个 Space 安静
            // 了很久、间隔已退到 60s，切过去之后新 Space 的变化要等一分钟才能看到。
            _attentionPoll?.notifyActivity();
        };
        _spaceReadyHandler = () => {
            initialSpaceReady = true;
            // 此时登录态与 X-Space-Id 已就绪，安全执行一次冷启动首刷。
            refreshSummaryAttentionBadge();
        };
        WKApp.mittBus.on('space-changed', _spaceChangedHandler);
        WKApp.mittBus.on('space-ready', _spaceReadyHandler);

        // ═══ 外部事件唤醒红点 ═══
        // 上面两个 handler 只盖住“本人切 Space / 冷启动”，其余刷新点全在详情页与
        // 确认页的本人动作上。别人拉你进多人总结、或总结在后台跑完时，本地没有
        // 任何动作，角标就不动——用户必须手动刷新页面才看得到。详见
        // utils/summaryAttentionSync.ts 头部注释。
        _attentionSync = createAttentionSync({ refresh: refreshSummaryAttentionBadge });

        // 回到标签页 / 重新聚焦。邀请场景没有 IM 推送可依赖（产品定下邀请不发 IM），
        // 靠的就是这两条。两个事件常常相继触发，由去抖合并成一次。
        // ═══ 无人值守时的兜底轮询 ═══
        // 上面那些触发源都要求【有事发生】：用户切回来、IM 来消息、IM 重连。
        // 但有两个状态没有任何事件可搭：被拉进多人总结（邀请不发 IM），以及
        // 「轮到你提交了」（pending_submission，服务端派生状态，同样无推送）。
        // 桌面端一开就是一整天，这两个状态下红点可以一整天不动。代价控制在
        // 自适应退避 + 可见性门控 + 跨标签页只一份上，详见
        // utils/summaryAttentionPoll.ts 与 utils/summaryAttentionLeader.ts 头部注释。
        _attentionPoll = createAttentionPoll({
            // 后台轮询【不】传 fresh：它是唯一一条无人值守就会产生的流量，
            // 让它吃服务端 5s 缓存，多个用户的 tick 撞在一起时后端只算一次。
            fetchCount: async () => {
                const count = await readSummaryAttentionCount();
                // null = 未登录 / Space 未就绪 / 飞行中切了 Space，本次没有可用样本。
                // 抄当前值回去，在调度器眼里就是一次「值未变」：不污染红点，也不会
                // 把这种早退当成失败去退避（未登录状态下退到 60s 毫无意义，登录后
                // 又得慢慢爬回来）。
                return count ?? getSummaryAttentionBadge();
            },
            isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
            onCount: (count) => {
                // leader 把结果广播给其它标签页，它们不必各发一份请求。降级模式下
                // publish 是 no-op（没有 channel），而那种情况下每个标签页本来就在自己拉。
                _attentionLeader?.publish(count, WKApp.shared.currentSpaceId ?? '');
            },
        });

        _attentionLeader = createAttentionLeader({
            onBecomeLeader: () => _attentionPoll?.start(),
            onResignLeader: () => _attentionPoll?.stop(),
            onRemoteCount: (count, spaceId) => {
                // 只接受与本标签页当前 Space 相同的广播：计数是 space-scoped 的，
                // 各标签页可能停在不同 Space 上，写错 Space 的数字比不刷新更糟。
                if (!spaceId || spaceId !== WKApp.shared.currentSpaceId) return;
                // 直接设值、不参与 ticket 排序：广播不是本标签页发出的读取，没有
                // 属于它的发出时刻可以排。它也不能抢号：若本标签页此刻正有一个用户
                // 动作触发的读取在飞，那个读取才更权威（它带 fresh=1，且反映的是本
                // 标签页用户刚做完的动作），它回来时会盖掉广播值。
                setSummaryAttentionBadge(count);
            },
        });
        _attentionLeader.start();

        // 可见性切换身兼两职：刷一次（_attentionSync）+ 控制轮询起停（不可见就【停表】，
        // 而不是空转跳拍）。两件事语义不同：前者是「现在刷一次」，后者是「接下来还
        // 要不要接着轮」。
        _visibilityHandler = () => {
            const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
            _attentionPoll?.setVisible(visible);
            if (!visible) return;
            _attentionSync?.trigger();
        };
        _focusHandler = () => {
            // 聚焦与可见性常常相继到达；刷新那边由固定窗口合并，轮询这边由
            // notifyActivity 自带的互斥与重排吸掉，不会变成两发请求。
            _attentionSync?.trigger();
            _attentionPoll?.notifyActivity();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', _visibilityHandler);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', _focusHandler);
        }

        // 站内路由切换（NavRail 菜单激活）同样算一次活动：用户在应用内走动说明他在用，
        // 轮询应该从退避档回到基础档。注意切标签页不会发这个事件，两者不重叠。
        _menuActivatedHandler = () => _attentionPoll?.notifyActivity();
        WKApp.mittBus.on('wk:active-menu-changed', _menuActivatedHandler);

        // IM 侧两条：收到群内总结完成提示（type-21 或 PR1534 之后的 WK_TIP 2000），
        // 以及重连成功后补齐离线期间的变更。用 try/catch 包住：红点是锦上添花，
        // 它的接线失败绝不应该把模块注册整个带崩（例如测试/嵌入环境里 SDK 未就绪）。
        try {
            const sdk = WKSDK.shared();
            _imMessageHandler = (message: unknown) => {
                if (shouldRefreshForMessage(message)) _attentionSync?.trigger();
            };
            sdk.chatManager.addMessageListener(_imMessageHandler as any);
            _imConnectHandler = (status: unknown) => {
                if (status === ConnectStatus.Connected) _attentionSync?.trigger();
            };
            sdk.connectManager.addConnectStatusListener(_imConnectHandler as any);
        } catch {
            // SDK 不可用（未登录 / 测试环境）时静默降级：仍有 visibility/focus 兑底。
        }

        WKApp.searchChatCandidates = async (params) => {
            return getChatCandidates(params);
        };

        // ═══ Chat window integration ═══

        WKApp.endpoints.registerChannelHeaderRightItem(
            "channelheader.summary",
            ({ channel }) => {
                if (!isSupportedChannelType(channel)) return undefined;
                return <ChatSummaryStarButton channel={channel} />;
            },
            5100,
        );

        WKApp.endpoints.registerChatSummaryPanel(
            "chatsummarypanel",
            ({ channel, onClose, summaryPanelView }) => (
                <ChatSummaryPanel
                    visible={true}
                    channel={channel}
                    onClose={onClose}
                    summaryPanelView={summaryPanelView}
                />
            ),
        );
    }
}

/**
 * 拆掉模块级的监听与定时器。
 *
 * 单独导出而不是直接写在 `import.meta.hot.dispose` 的回调里，是为了让它
 * 【可被单测真的调一遍】：vitest 跑的是非 HMR 构建，`import.meta.hot` 恒为
 * undefined，写在里面的代码在测试里永远不会执行——而「加了监听/定时器却忘了
 * 拆」正是这个模块真实发生过的 bug，且代价很实：一个下午的开发会话能叠出
 * 几十条并行轮询链，而且旧链持有的是旧模块实例。提成函数后，清单是否完整
 * 就能被断言，而不是只能靠人读。幂等：重复调用无副作用。
 */
export function disposeSummaryModuleListeners(): void {
    if (_spaceChangedHandler) {
        WKApp.mittBus.off('space-changed', _spaceChangedHandler);
        _spaceChangedHandler = null;
    }
    if (_spaceReadyHandler) {
        WKApp.mittBus.off('space-ready', _spaceReadyHandler);
        _spaceReadyHandler = null;
    }
    // 外部事件监听也要拆，否则每次热更都会叠一层，一个 visibilitychange
    // 最后会打出 N 个请求。
    if (_visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', _visibilityHandler);
    }
    _visibilityHandler = null;
    if (_focusHandler && typeof window !== 'undefined') {
        window.removeEventListener('focus', _focusHandler);
    }
    _focusHandler = null;
    try {
        const sdk = WKSDK.shared();
        if (_imMessageHandler) sdk.chatManager.removeMessageListener(_imMessageHandler as any);
        if (_imConnectHandler) sdk.connectManager.removeConnectStatusListener(_imConnectHandler as any);
    } catch {
        // 与注册处对称：SDK 不可用时无需拆。
    }
    _imMessageHandler = null;
    _imConnectHandler = null;
    _attentionSync?.cancel();
    _attentionSync = null;
    // 轮询与 leader 心跳都是真实的定时器，漏一个就会在每次热更后叠一层。
    // 先停 leader：它会回调 onResignLeader 把轮询停表，同时关掉 BroadcastChannel
    // 并让出租约（让其它标签页立即接管，不必等租约过期）。
    _attentionLeader?.stop();
    _attentionLeader = null;
    // 再显式 stop 一次：降级模式下轮询是被直接拉起来的，不依赖 leader 回调；
    // stop 幂等，多调一次比漏一个定时器安全。
    _attentionPoll?.stop();
    _attentionPoll = null;
    if (_menuActivatedHandler) {
        WKApp.mittBus.off('wk:active-menu-changed', _menuActivatedHandler);
        _menuActivatedHandler = null;
    }
}

if (import.meta.hot) {
    import.meta.hot.dispose(disposeSummaryModuleListeners);
}

/**
 * 聊天上下文里创建总结成功后的收尾动作（实现见 utils/chatSummaryActions，
 * 拆分到独立文件以便单测不必经过引入 react-dom/client 的本模块）。
 */
