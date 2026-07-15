import React, { useEffect, useState } from "react";
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
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key, findWs(workspaces, wsId)));
  };

  // 新建回路 → 唤起统一建单弹窗（对齐 multica，不再拉起独立 AI 页）。成功后落回路看板并刷新。
  const openNewLoop = () => setCreateOpen(true);

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
      WKApp.routeRight.replaceToRoot(renderTab(tab, ws));
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
    listWorkspaces()
      .then((list) => {
        setLoaded(true);
        const first = findWs(list, currentWorkspaceId()) ?? list[0] ?? null;
        applyWorkspace(first, list);
      })
      .catch(() => { setLoaded(true); showEmptyGuide(); });
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

  const switchWorkspace = (w: Workspace) => {
    setWorkspaceContext(w.slug, w.id, w.name);
    setWsId(w.id);
    resetWorkspaceCaches();
    WKApp.routeRight.replaceToRoot(renderTab(tab, w));
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
    setWsBusy(true);
    try {
      // auto slug re-rolls its random suffix on the backend's 409 (slug is
      // globally unique) so the happy path needs no manual input; a user-typed
      // slug is surfaced as taken, never silently changed.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const created = await createWorkspace({ name, slug });
          setWsModalOpen(false);
          const list = await reloadWorkspaces();
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
