import React from "react";
import type { IModule } from "@octo/base";
import { i18n, WKApp, Menus, t as translate } from "@octo/base";
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
import { getPendingInvitationBadge, refreshPendingInvitationBadge } from "./utils/summaryMenuBadge";
import { isSupportedChannelType } from "./utils/channelType";
import ChatSummaryStarButton from "./components/ChatSummaryStarButton";
import ChatSummaryPanel from "./components/ChatSummaryPanel";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";
import "./index.css";

let _spaceChangedHandler: (() => void) | null = null;
const openingSummaryShares = new Set<string>();

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
        // (menuId === "summary") 保持一致；路由指向 /summary 列表页（列表页内「新建」
        // 进入创建页，可选参与者 + 定时）。
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
                // #1359 未处理邀请红点：badge 字段与 NavRail 渲染已存在，
                // 此处每次 render 读最新计数即可（宿主 forceUpdate 驱动重绘）。
                menu.badge = getPendingInvitationBadge();
                // 保留既有顶层入口行为：点击后直接进入新建总结页。
                menu.onPress = () => {
                    WKApp.routeLeft.popToRoot();
                    const page = WKApp.route.get("/summary/create");
                    if (page && React.isValidElement(page)) {
                        WKApp.routeRight.replaceToRoot(page);
                    }
                };
                return menu;
            },
            4002,
        );

        _spaceChangedHandler = () => {
            WKApp.mittBus.emit('summary-space-changed');
            // 首次 Space 解析和后续切换都从宿主发出该事件；此时登录态与
            // X-Space-Id 已就绪，再拉取 Space 级邀请计数，避免 init 期 401/404。
            refreshPendingInvitationBadge();
        };
        WKApp.mittBus.on('space-changed', _spaceChangedHandler);

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

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (_spaceChangedHandler) {
            WKApp.mittBus.off('space-changed', _spaceChangedHandler);
            _spaceChangedHandler = null;
        }
    });
}

/**
 * 聊天上下文里创建总结成功后的收尾动作（实现见 utils/chatSummaryActions，
 * 拆分到独立文件以便单测不必经过引入 react-dom/client 的本模块）。
 */
