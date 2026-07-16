import React, { useEffect, useRef, useState } from "react";
import { Typography, Dropdown, Avatar, Modal, Toast } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import {
  ClipboardList, Briefcase, Bot, Users, Settings,
  ChevronDown, Check, Plus, SquarePen, FolderPlus,
  Zap, CircleUserRound,
} from "lucide-react";
import { useI18n, WKApp, getPinyin } from "@octo/base";
import type { Workspace } from "../api/types";
import { listWorkspaces, createWorkspace } from "../api/workspaceApi";
import { setWorkspaceContext, currentWorkspaceId } from "../api/http";
import { invalidateDirectory } from "../api/directory";
import { invalidateRuntimeMap, invalidateAgentStatus } from "../api/agentApi";
import { slugSuffix, withRandomSuffix } from "../ui/slug";
import IssuePage from "./IssuePage";
import CreateIssueModal from "../ui/CreateIssueModal";
import ProjectPage from "./ProjectPage";
import AgentPage from "./AgentPage";
import SquadPage from "./SquadPage";
import AutomationPage from "./AutomationPage";
import SettingsPage from "./SettingsPage";
import "./loop.css";
import "../ui/loopControls.css";

const { Title, Text } = Typography;

// 切换工作区时统一重置所有工作区级缓存(目录/运行时/agent 状态),避免残留上个工作区数据。
function resetWorkspaceCaches() {
  invalidateDirectory();
  invalidateRuntimeMap();
  invalidateAgentStatus();
}

type TabKey = "myloop" | "issue" | "project" | "automation" | "agent" | "squad" | "settings";


// 顶部独立入口：我的回路（复用 Issue 视图的「与我相关」分组）。
const MY_TAB: { key: TabKey; icon: React.ReactNode } = { key: "myloop", icon: <CircleUserRound size={16} /> };
// 工作区分组：回路 / 项目 / 自动化 / AI队友 / AI小队。
const WORKSPACE_TABS: { key: TabKey; icon: React.ReactNode }[] = [
  { key: "issue", icon: <ClipboardList size={16} /> },
  { key: "project", icon: <Briefcase size={16} /> },
  { key: "automation", icon: <Zap size={16} /> },
  { key: "agent", icon: <Bot size={16} /> },
  { key: "squad", icon: <Users size={16} /> },
];
const SETTINGS_TAB: { key: TabKey; icon: React.ReactNode } = { key: "settings", icon: <Settings size={16} /> };

export default function LoopPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("issue");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string>(currentWorkspaceId());
  const [loaded, setLoaded] = useState(false);
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [wsSlugTouched, setWsSlugTouched] = useState(false);
  const [wsSlugSuffix, setWsSlugSuffix] = useState("");
  const [wsBusy, setWsBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // tab 的同步镜像:mount-once 的 space-changed 副作用闭包(deps=[])会冻结当时的 tab,
  // 用 ref 让 applyWorkspace 始终读到最新 tab,避免切 space 后右栏恒被铺成初始 issue。
  const tabRef = useRef<TabKey>("issue");
  tabRef.current = tab;
  // space-changed 重解析的过期守卫:快速连切 space 时并发的 listWorkspaces 可能乱序返回,
  // 只有最后一次解析允许写回 workspace context,否则慢的旧响应会把旧 slug 落回、撞新 space 的 403。
  const spaceResolveSeqRef = useRef(0);

  const findWs = (list: Workspace[], id: string) => list.find((w) => w.id === id) ?? null;

  const renderTab = (key: TabKey, ws: Workspace | null): JSX.Element => {
    // 以「当前 workspace」为 key 驱动整颗子页面：切换 workspace → key 变化 → React 强制
    // 重挂子页面 → useEffect 重新以新的 x-workspace-slug 拉取数据，避免残留旧 workspace 数据。
    const k = `${key}:${ws?.id ?? "none"}`;
    switch (key) {
      case "myloop": return <IssuePage key={k} viewKey="loop.view.myloop" defaultView="grouped" defaultScope="involves" />;
      case "issue": return <IssuePage key={k} viewKey="loop.view.issue" />;
      case "project": return <ProjectPage key={k} />;
      case "automation": return <AutomationPage key={k} />;
      case "agent": return <AgentPage key={k} />;
      case "squad": return <SquadPage key={k} />;
      case "settings": return <SettingsPage key={k} workspace={ws} onUpdated={() => reloadWorkspaces()} />;
      default: return <IssuePage key={k} viewKey="loop.view.issue" />;
    }
  };

  const openTab = (key: TabKey) => {
    // 重解析窗口期(切 space 后 loaded=false 直到新 space 的 workspace 解析完成)不响应:
    // 此时 workspaces/wsId 尚属旧 space,点击会用旧作用域渲染 workspace 级页面。
    if (!loaded) return;
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key, findWs(workspaces, wsId)));
  };

  // 新建回路 → 唤起统一建单弹窗（对齐 multica，不再拉起独立 AI 页）。成功后落回路看板并刷新。
  const openNewLoop = () => { if (!loaded) return; setCreateOpen(true); };

  // 空态引导：无 workspace 时右栏提示创建
  const showEmptyGuide = () => {
    WKApp.routeRight.replaceToRoot(
      <div className="loop-page"><div className="loop-empty">
        <FolderPlus size={44} className="loop-empty__icon" />
        <div className="loop-empty__title">{t("loop.workspace.emptyTitle")}</div>
        <div className="loop-empty__desc">{t("loop.workspace.emptyDesc")}</div>
      </div></div>,
    );
  };

  const applyWorkspace = (ws: Workspace | null, list: Workspace[]) => {
    if (ws) {
      setWorkspaceContext(ws.slug, ws.id, ws.name);
      setWsId(ws.id);
      resetWorkspaceCaches();
      WKApp.routeRight.replaceToRoot(renderTab(tabRef.current, ws));
    } else {
      setWorkspaceContext("", "");
      setWsId("");
      showEmptyGuide();
    }
    setWorkspaces(list);
  };

  const reloadWorkspaces = async (): Promise<Workspace[]> => {
    const list = await listWorkspaces().catch(() => [] as Workspace[]);
    setWorkspaces(list);
    return list;
  };

  useEffect(() => {
    // mount 初始解析也纳入 spaceResolveSeqRef 域:若初始 listWorkspaces 尚未返回、
    // 用户就切了 space,space-changed 会递增 seq 使这次 mount 响应过期被丢弃,避免旧 space
    // 的 workspace slug 被写回 http 层、撞新 space 的隔离 403(与 space-changed 共享守卫)。
    const seq = ++spaceResolveSeqRef.current;
    listWorkspaces()
      .then((list) => {
        if (seq !== spaceResolveSeqRef.current) return;
        setLoaded(true);
        const first = findWs(list, currentWorkspaceId()) ?? list[0] ?? null;
        applyWorkspace(first, list);
      })
      .catch(() => {
        if (seq !== spaceResolveSeqRef.current) return;
        setLoaded(true);
        showEmptyGuide();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶部一级导航「Loop」被再次点击时，onMenuClick 会先 routeRight.popToRoot() 清空右栏
  // （LoopPage 常驻不重挂，useEffect 不会重跑）。这里监听激活事件，把体验对齐「首次进入」
  // ——重置到默认的 Issue（回路）视图，避免右栏残留空白/报错。
  useEffect(() => {
    const onNavMenuActivated = ({ menuId }: { menuId: string }) => {
      if (menuId !== "loop") return;
      // workspace 列表尚未加载完时不处理：挂载副作用会在加载完成后自行铺默认视图，
      // 避免 workspaces 还是 [] 时误闪空态引导。
      if (!loaded) return;
      const ws = findWs(workspaces, wsId);
      if (!ws) { showEmptyGuide(); return; }
      setTab("issue");
      WKApp.routeRight.replaceToRoot(renderTab("issue", ws));
      // 已停在 issue tab 时 key(issue:wsId) 不变不会重挂 → 补发刷新事件，让当前 IssuePage 重新拉数(data→view)。
      setTimeout(() => WKApp.mittBus.emit("wk:loop-issues-refresh"), 0);
    };
    WKApp.mittBus.on("wk:nav-menu-activated", onNavMenuActivated);
    return () => WKApp.mittBus.off("wk:nav-menu-activated", onNavMenuActivated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, wsId, loaded]);

  // 切换 octo space 时,当前 wsId + @octo/loop 模块级 workspace 全局属于上一个 space,
  // 必须作废重判 —— 否则会带旧 workspace 作用域向新 space 发 workspace 维度请求,撞后端
  // space 隔离闸门(workspace does not belong to this space / not a member of this space)。
  // 先 setWorkspaceContext("","") 清 http 层旧 slug,避免重列期间任何请求带旧作用域;再重新
  // listWorkspaces 并铺新 space 的默认 workspace,新 space 无 workspace 时 applyWorkspace(null)
  // 自然落入空态引导(showEmptyGuide)。
  useEffect(() => {
    const onSpaceChanged = () => {
      const seq = ++spaceResolveSeqRef.current;
      setWorkspaceContext("", "");
      setWsId("");
      // setLoaded(false):重解析窗口期把页面标回"未加载",wk:nav-menu-activated 的
      // `if (!loaded) return` 守卫随之生效,避免窗口期用旧 workspaces 闭包渲染 workspace 级页面。
      setLoaded(false);
      resetWorkspaceCaches();
      // Unmount the stale right pane immediately so the previous space's
      // IssuePage (and its polling / create entry) stops firing requests during
      // the re-resolve window; applyWorkspace repaints once the new space resolves.
      WKApp.routeRight.replaceToRoot(<div className="loop-page" />);
      listWorkspaces()
        .then((list) => {
          // 过期守卫:快速连切 space 时只让最后一次解析落地,丢弃乱序返回的旧响应,
          // 否则旧响应的 applyWorkspace 会把旧 slug 落回 http 层、撞新 space 的隔离 403。
          if (seq !== spaceResolveSeqRef.current) return;
          setLoaded(true);
          const first = findWs(list, currentWorkspaceId()) ?? list[0] ?? null;
          applyWorkspace(first, list);
        })
        .catch(() => {
          if (seq !== spaceResolveSeqRef.current) return;
          setLoaded(true);
          showEmptyGuide();
        });
    };
    WKApp.mittBus.on("space-changed", onSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", onSpaceChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchWorkspace = (w: Workspace) => {
    // 重解析窗口期不响应:下拉里的 w 属于旧 space 的 workspaces,选它会把旧 slug 写回。
    if (!loaded) return;
    setWorkspaceContext(w.slug, w.id, w.name);
    setWsId(w.id);
    resetWorkspaceCaches();
    WKApp.routeRight.replaceToRoot(renderTab(tabRef.current, w));
  };

  const openCreateWs = () => {
    setWsName(""); setWsSlug(""); setWsSlugTouched(false); setWsSlugSuffix(slugSuffix()); setWsModalOpen(true);
  };
  const doCreateWs = async () => {
    const name = wsName.trim();
    if (!name) { Toast.warning(t("loop.workspace.nameRequired")); return; }
    const autoSlug = !wsSlugTouched;
    let slug = wsSlug.trim() || withRandomSuffix(getPinyin(name), wsSlugSuffix);
    if (!slug) { Toast.warning(t("loop.workspace.slugRequired")); return; }
    // Join the resolve generation: creating a workspace writes workspace context
    // after awaits, so if the user switches octo space mid-create, the space-changed
    // handler bumps the seq and the post-await applyWorkspace below is dropped —
    // otherwise it would write this space's workspace slug under the new space's
    // X-Space-Id and re-trigger the isolation 403.
    const seq = ++spaceResolveSeqRef.current;
    setWsBusy(true);
    try {
      // auto slug re-rolls its random suffix on the backend's 409 (slug is
      // globally unique) so the happy path needs no manual input; a user-typed
      // slug is surfaced as taken, never silently changed.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Re-check before each create so a space switch during a 409 retry
          // doesn't create a stray workspace in the newly-selected space.
          if (seq !== spaceResolveSeqRef.current) return;
          const created = await createWorkspace({ name, slug });
          setWsModalOpen(false);
          const list = await reloadWorkspaces();
          // A space switch during creation invalidates this write; the
          // space-changed resolve owns the pane now.
          if (seq !== spaceResolveSeqRef.current) return;
          applyWorkspace(findWs(list, created.id) ?? created, list);
          setTab("issue");
          WKApp.routeRight.replaceToRoot(<IssuePage viewKey="loop.view.issue" />);
          Toast.success(t("loop.workspace.created"));
          return;
        } catch (e) {
          if ((e as { status?: number })?.status !== 409) throw e;
          if (!autoSlug || attempt === 2) { Toast.error(t("loop.workspace.slugTaken")); return; }
          slug = withRandomSuffix(getPinyin(name), slugSuffix());
        }
      }
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
    finally { setWsBusy(false); }
  };

  const current = findWs(workspaces, wsId);
  const hasWs = workspaces.length > 0;

  const wsMenu = (
    <Dropdown.Menu>
      <Dropdown.Title>{t("loop.workspace.title")}</Dropdown.Title>
      {workspaces.map((w) => (
        <Dropdown.Item key={w.id} onClick={() => switchWorkspace(w)}
          icon={<Avatar size="extra-extra-small" color="blue" shape="square">{w.name.slice(0, 1)}</Avatar>}>
          <span style={{ flex: 1 }}>{w.name}</span>
          {w.id === wsId && <Check size={14} />}
        </Dropdown.Item>
      ))}
      <Dropdown.Divider />
      <Dropdown.Item icon={<FolderPlus size={14} />} onClick={openCreateWs}>
        {t("loop.workspace.create")}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <div className="loop-sidebar">
      <div className="loop-sidebar__ws">
        <Dropdown render={wsMenu} trigger="click" position="bottomLeft" clickToHide>
          <button className="loop-sidebar__ws-btn">
            <Avatar size="extra-extra-small" color="blue" shape="square">{(current?.name ?? "L").slice(0, 1)}</Avatar>
            <span className="loop-sidebar__ws-name">{current?.name ?? (loaded && !hasWs ? t("loop.workspace.none") : t("loop.menu.title"))}</span>
            <ChevronDown size={14} style={{ opacity: 0.5 }} />
          </button>
        </Dropdown>
      </div>

      {!hasWs && loaded ? (
        <div className="loop-sidebar__new">
          <LoopButton block icon={<FolderPlus size={14} />} onClick={openCreateWs}>{t("loop.workspace.create")}</LoopButton>
        </div>
      ) : (
        <>
          <div className="loop-sidebar__new">
            <button className="loop-sidebar__new-btn" onClick={openNewLoop}>
              <SquarePen size={15} />
              <span>{t("loop.action.newIssue")}</span>
              <Plus size={14} style={{ marginLeft: "auto", opacity: 0.5 }} />
            </button>
          </div>
          <nav className="loop-sidebar__menu">
            <button className={`loop-sidebar__item ${tab === MY_TAB.key ? "is-active" : ""}`} onClick={() => openTab(MY_TAB.key)}>
              {MY_TAB.icon}
              <span>{t(`loop.nav.${MY_TAB.key}`)}</span>
            </button>
            <div className="loop-sidebar__group-label">{t("loop.nav.workspaceGroup")}</div>
            {WORKSPACE_TABS.map((it) => (
              <button key={it.key} className={`loop-sidebar__item ${tab === it.key ? "is-active" : ""}`} onClick={() => openTab(it.key)}>
                {it.icon}
                <span>{t(`loop.nav.${it.key}`)}</span>
              </button>
            ))}
            <button className={`loop-sidebar__item ${tab === SETTINGS_TAB.key ? "is-active" : ""}`} onClick={() => openTab(SETTINGS_TAB.key)}>
              {SETTINGS_TAB.icon}
              <span>{t(`loop.nav.${SETTINGS_TAB.key}`)}</span>
            </button>
          </nav>
        </>
      )}

      <Modal
        className="loop-modal"
        title={t("loop.workspace.create")}
        visible={wsModalOpen}
        onOk={doCreateWs}
        onCancel={() => setWsModalOpen(false)}
        okText={t("loop.action.create")}
        cancelText={t("loop.action.cancel")}
        okButtonProps={{ loading: wsBusy }}
      >
        <div className="loop-fields">
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.settings.wsName")}</div>
            <input autoFocus className="loop-field" value={wsName} onChange={(e) => { setWsName(e.target.value); if (!wsSlugTouched) setWsSlug(e.target.value.trim() ? withRandomSuffix(getPinyin(e.target.value), wsSlugSuffix) : ""); }} placeholder={t("loop.workspace.namePlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.settings.wsSlug")}</div>
            <input className="loop-field" value={wsSlug} onChange={(e) => { setWsSlug(e.target.value); setWsSlugTouched(true); }} placeholder="my-workspace" />
          </div>
        </div>
      </Modal>
      <CreateIssueModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          openTab("issue");
          // 若已在 issue tab（同 key 不重挂），补发刷新使新回路即时出现。
          setTimeout(() => WKApp.mittBus.emit("wk:loop-issues-refresh"), 0);
          Toast.success(t("loop.toast.created"));
        }}
      />
    </div>
  );
}
