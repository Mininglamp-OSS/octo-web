import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import type { IModule } from "@octo/base";
import { i18n, I18nProvider, WKApp, Menus, t as translate } from "@octo/base";
import SummaryListPage from "./pages/SummaryListPage";
import SummaryCreatePage from "./pages/SummaryCreatePage";
import SummaryDetailPage from "./pages/SummaryDetailPage";
import SummaryConfirmPage from "./pages/SummaryConfirmPage";
import ScheduleListPage from "./pages/ScheduleListPage";
import { getChatCandidates, listSummaries } from "./api/summaryApi";
import { notifyChatSummaryCreated } from "./utils/chatSummaryActions";
import { isSupportedChannelType } from "./utils/channelType";
import ChatSummaryStarButton from "./components/ChatSummaryStarButton";
import ChatSummaryPanel from "./components/ChatSummaryPanel";
import ChatSummaryNewModal from "./components/ChatSummaryNewModal";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

let _spaceChangedHandler: (() => void) | null = null;
let _attentionRefreshTimer: ReturnType<typeof setInterval> | null = null;
let _attentionFocusHandler: (() => void) | null = null;
let _attentionRefreshRequestHandler: (() => void) | null = null;
let _attentionBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
let _attentionRequest: Promise<boolean> | null = null;

async function refreshSummaryAttentionCount(): Promise<boolean> {
    if (!WKApp.loginInfo.isLogined() || !WKApp.shared.currentSpaceId) return false;
    if (_attentionRequest) return _attentionRequest;
    _attentionRequest = (async () => {
      try {
        const response = await listSummaries({ page: 1, page_size: 1 });
        WKApp.mittBus.emit("summary-badge-update" as any, {
            count: response.attention_count ?? 0,
        });
        WKApp.mittBus.emit("summary-attention-count-refreshed" as any, {
            count: response.attention_count ?? 0,
        });
        return true;
      } catch {
        // Navigation badge is best-effort and must not block application startup.
        return false;
      } finally {
        _attentionRequest = null;
      }
    })();
    return _attentionRequest;
}

function bootstrapSummaryAttentionCount(attempt = 0) {
    void refreshSummaryAttentionCount().then((loaded) => {
        if (loaded || attempt >= 50) return;
        // Module initialization can precede login/Space restoration on a cold
        // page load. Retry quickly until both are ready instead of waiting for
        // the five-second background poll.
        _attentionBootstrapTimer = setTimeout(() => {
            bootstrapSummaryAttentionCount(attempt + 1);
        }, 100);
    });
}

/**
 * NavRail 顶层菜单图标（智能总结）。与 dmworktodo / dmworkappbot 的菜单图标同构：
 * 纯 SVG、随 active 变色，不引入额外依赖。
 */
function SummaryMenuIcon({ active }: { active?: boolean }) {
    const color = active ? "var(--wk-brand-primary, #7C5CFC)" : "currentColor";
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h6" />
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

        WKApp.openSummaryDetail = (taskId: number | string, spaceId?: string) => {
            // 卡片深链带的空间可能≠当前空间，路由前先切目标空间，与浏览器路由 applyStandaloneSummarySpaceFromQuery 对称。
            if (spaceId) WKApp.shared.currentSpaceId = spaceId;
            WKApp.switchToMenuById?.("summary");
            WKApp.routeLeft.popToRoot();
            WKApp.routeRight.replaceToRoot(
                <SummaryDetailPage taskId={taskId} />
            );
        };

        WKApp.route.register("/summary", () => {
            return <SummaryListPage />;
        });

        WKApp.route.register("/summary/create", () => {
            return <SummaryCreatePage />;
        });

        // 详情页「继续优化」按钮 → 打开新的 chat + 预填引用。
        // 通过 window 事件与详情页解耦(避免循环导入),这里 addEventListener
        // 后统一走 WKApp.routeRight.push 弹出新的 SummaryCreatePage 实例。
        // 见 CHAT-REFERENCE-BASED-DESIGN-v1。
        window.addEventListener('summary-open-chat-with-reference', ((e: CustomEvent) => {
            const task = e.detail;
            if (!task || !task.task_id) return;
            WKApp.routeRight.push(<SummaryCreatePage derivedFromTask={task} />);
        }) as EventListener);

        WKApp.route.register("/summary/detail", (param: any) => {
            return <SummaryDetailPage taskId={param?.taskId} />;
        });

        WKApp.route.register("/summary/confirm", (param: any) => {
            return <SummaryConfirmPage taskId={param?.taskId} />;
        });

        WKApp.route.register("/summary/schedules", () => {
            return <ScheduleListPage />;
        });

        // 顶层 NavRail 菜单入口（sort=4002，紧跟在 contacts=4000 / matter=4001 之后）。
        // 背景：之前 summary 只挂了路由 + 聊天窗口星标按钮，没有顶层可见菜单，
        // 导致「多人协作 / 多人定时」入口在主导航上找不到。菜单 id 须为 "summary"，
        // 与 WKApp.switchToMenuById("summary") 及 SummaryListPage 监听的 wk:nav-menu-activated
        // (menuId === "summary") 保持一致；路由指向 /summary 列表页（列表页内「新建」
        // 进入创建页，可选参与者 + 定时）。
        WKApp.menus.register(
            "summary",
            () => {
                return new Menus(
                    "summary",
                    "/summary",
                    translate("summary.menu.title"),
                    <SummaryMenuIcon />,
                    <SummaryMenuIcon active />,
                );
            },
            4002,
        );

        _spaceChangedHandler = () => {
            WKApp.mittBus.emit('summary-space-changed');
            void refreshSummaryAttentionCount();
        };
        WKApp.mittBus.on('space-changed', _spaceChangedHandler);

        // SummaryListPage is mounted only after the menu is opened. Keep the
        // global navigation badge fresh independently so invitations are
        // visible before the invitee enters Smart Summary.
        bootstrapSummaryAttentionCount();
        _attentionRefreshTimer = setInterval(() => {
            if (document.visibilityState === "visible") {
                void refreshSummaryAttentionCount();
            }
        }, 5000);
        _attentionFocusHandler = () => void refreshSummaryAttentionCount();
        window.addEventListener("focus", _attentionFocusHandler);
        _attentionRefreshRequestHandler = () => void refreshSummaryAttentionCount();
        WKApp.mittBus.on("summary-attention-refresh-requested" as any, _attentionRefreshRequestHandler);

        WKApp.searchChatCandidates = async (params) => {
            return getChatCandidates(params);
        };

        mountGlobalSummaryModal();

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
            ({ channel, onClose }) => (
                <ChatSummaryPanel
                    visible={true}
                    channel={channel}
                    onClose={onClose}
                />
            ),
        );
    }
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (_spaceChangedHandler) {
            WKApp.mittBus.off('space-changed', _spaceChangedHandler);
            _spaceChangedHandler = null;
        }
        if (_attentionRefreshTimer) {
            clearInterval(_attentionRefreshTimer);
            _attentionRefreshTimer = null;
        }
        if (_attentionFocusHandler) {
            window.removeEventListener("focus", _attentionFocusHandler);
            _attentionFocusHandler = null;
        }
        if (_attentionRefreshRequestHandler) {
            WKApp.mittBus.off("summary-attention-refresh-requested" as any, _attentionRefreshRequestHandler);
            _attentionRefreshRequestHandler = null;
        }
        if (_attentionBootstrapTimer) {
            clearTimeout(_attentionBootstrapTimer);
            _attentionBootstrapTimer = null;
        }
        _globalSummaryModalRoot?.unmount();
        _globalSummaryModalRoot = null;
        const el = document.getElementById("summary-global-modal-root");
        if (el) el.remove();
        _globalSummaryModalMounted = false;
    });
}

let _globalSummaryModalMounted = false;
let _globalSummaryModalRoot: ReturnType<typeof ReactDOM.createRoot> | null = null;

function mountGlobalSummaryModal() {
    if (_globalSummaryModalMounted) return;
    _globalSummaryModalMounted = true;
    const container = document.createElement("div");
    container.id = "summary-global-modal-root";
    document.body.appendChild(container);
    _globalSummaryModalRoot = ReactDOM.createRoot(container);
    // 独立 root 不在主应用 <I18nProvider> 子树内，须自行包裹，
    // 否则全局弹窗运行时切语言不会刷新（拿到的是 I18nContext 默认值）。
    _globalSummaryModalRoot.render(
        <I18nProvider>
            <GlobalSummaryModal />
        </I18nProvider>,
    );
}

/**
 * 聊天上下文里创建总结成功后的收尾动作（实现见 utils/chatSummaryActions，
 * 拆分到独立文件以便单测不必经过引入 react-dom/client 的本模块）。
 */
function GlobalSummaryModal() {
    const [open, setOpen] = useState(false);
    const [channel, setChannel] = useState<{ channelID: string; channelType: number } | null>(null);

    useEffect(() => {
        const handler = (data: { channelId: string; channelType: number }) => {
            setChannel({ channelID: data.channelId, channelType: data.channelType });
            setOpen(true);
        };
        WKApp.mittBus.on("wk:open-summary-modal", handler);
        return () => {
            WKApp.mittBus.off("wk:open-summary-modal", handler);
        };
    }, []);

    if (!open || !channel) return null;

    return (
        <ChatSummaryNewModal
            visible={open}
            channel={channel}
            onClose={() => setOpen(false)}
            onSubmit={() => {
                setOpen(false);
                // 聊天上下文：不切换主 Tab（不调用 openSummaryDetail），
                // 改为在聊天侧栏内打开/刷新「智能总结」面板展示新建的总结。
                notifyChatSummaryCreated(channel);
            }}
        />
    );
}
