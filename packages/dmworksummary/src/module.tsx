import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import type { IModule } from "@octo/base";
import { i18n, I18nProvider, WKApp } from "@octo/base";
import SummaryListPage from "./pages/SummaryListPage";
import SummaryCreatePage from "./pages/SummaryCreatePage";
import SummaryDetailPage from "./pages/SummaryDetailPage";
import SummaryConfirmPage from "./pages/SummaryConfirmPage";
import ScheduleListPage from "./pages/ScheduleListPage";
import { getChatCandidates } from "./api/summaryApi";
import { notifyChatSummaryCreated } from "./utils/chatSummaryActions";
import { isSupportedChannelType } from "./utils/channelType";
import ChatSummaryStarButton from "./components/ChatSummaryStarButton";
import ChatSummaryPanel from "./components/ChatSummaryPanel";
import ChatSummaryNewModal from "./components/ChatSummaryNewModal";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

let _spaceChangedHandler: (() => void) | null = null;

export class SummaryModule implements IModule {
    id(): string {
        return "SummaryModule";
    }

    init(): void {
        i18n.registerNamespace("summary", {
            "zh-CN": zhCN,
            "en-US": enUS,
        });

        WKApp.openSummaryDetail = (taskId: number) => {
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

        WKApp.route.register("/summary/detail", (param: any) => {
            return <SummaryDetailPage taskId={param?.taskId} />;
        });

        WKApp.route.register("/summary/confirm", (param: any) => {
            return <SummaryConfirmPage taskId={param?.taskId} />;
        });

        WKApp.route.register("/summary/schedules", () => {
            return <ScheduleListPage />;
        });

        _spaceChangedHandler = () => {
            WKApp.mittBus.emit('summary-space-changed');
        };
        WKApp.mittBus.on('space-changed', _spaceChangedHandler);

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
