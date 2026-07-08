import React, { useEffect, useState } from "react";
import { Typography, Dropdown, Avatar, Modal, Input, Toast, Button } from "@douyinfe/semi-ui";
import {
  ClipboardList, Sparkles, Briefcase, Bot, Users, Cpu, Settings,
  ChevronDown, Check, Plus, SquarePen, FolderPlus,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Workspace } from "../api/types";
import { listWorkspaces, createWorkspace } from "../api/workspaceApi";
import { setWorkspaceContext, currentWorkspaceId } from "../api/http";
import { invalidateDirectory } from "../api/directory";
import { invalidateRuntimeMap } from "../api/agentApi";
import CreateIssueModal from "../ui/CreateIssueModal";
import IssuePage from "./IssuePage";
import SkillPage from "./SkillPage";
import ProjectPage from "./ProjectPage";
import AgentPage from "./AgentPage";
import SquadPage from "./SquadPage";
import RuntimePage from "./RuntimePage";
import SettingsPage from "./SettingsPage";
import "./loop.css";

const { Title, Text } = Typography;

type TabKey = "issue" | "skill" | "project" | "agent" | "squad" | "runtime" | "settings";

const TABS: { key: TabKey; icon: React.ReactNode }[] = [
  { key: "issue", icon: <ClipboardList size={16} /> },
  { key: "skill", icon: <Sparkles size={16} /> },
  { key: "project", icon: <Briefcase size={16} /> },
  { key: "agent", icon: <Bot size={16} /> },
  { key: "squad", icon: <Users size={16} /> },
  { key: "runtime", icon: <Cpu size={16} /> },
  { key: "settings", icon: <Settings size={16} /> },
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export default function LoopPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("issue");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string>(currentWorkspaceId());
  const [loaded, setLoaded] = useState(false);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [wsSlugTouched, setWsSlugTouched] = useState(false);
  const [wsBusy, setWsBusy] = useState(false);

  const findWs = (list: Workspace[], id: string) => list.find((w) => w.id === id) ?? null;

  const renderTab = (key: TabKey, ws: Workspace | null): JSX.Element => {
    // 以「当前 workspace」为 key 驱动整颗子页面：切换 workspace → key 变化 → React 强制
    // 重挂子页面 → useEffect 重新以新的 x-workspace-slug 拉取数据，避免残留旧 workspace 数据。
    const k = `${key}:${ws?.id ?? "none"}`;
    switch (key) {
      case "issue": return <IssuePage key={k} />;
      case "skill": return <SkillPage key={k} />;
      case "project": return <ProjectPage key={k} />;
      case "agent": return <AgentPage key={k} />;
      case "squad": return <SquadPage key={k} />;
      case "runtime": return <RuntimePage key={k} />;
      case "settings": return <SettingsPage key={k} workspace={ws} onUpdated={() => reloadWorkspaces()} />;
      default: return <IssuePage key={k} />;
    }
  };

  const openTab = (key: TabKey) => {
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key, findWs(workspaces, wsId)));
  };

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
      setWorkspaceContext(ws.slug, ws.id);
      setWsId(ws.id);
      invalidateDirectory();
      invalidateRuntimeMap();
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

  const switchWorkspace = (w: Workspace) => {
    setWorkspaceContext(w.slug, w.id);
    setWsId(w.id);
    invalidateDirectory();
    invalidateRuntimeMap();
    WKApp.routeRight.replaceToRoot(renderTab(tab, w));
  };

  const openCreateWs = () => {
    setWsName(""); setWsSlug(""); setWsSlugTouched(false); setWsModalOpen(true);
  };
  const doCreateWs = async () => {
    if (!wsName.trim()) { Toast.warning(t("loop.workspace.nameRequired")); return; }
    const slug = (wsSlug.trim() || slugify(wsName));
    if (!slug) { Toast.warning(t("loop.workspace.slugRequired")); return; }
    setWsBusy(true);
    try {
      const created = await createWorkspace({ name: wsName.trim(), slug });
      setWsModalOpen(false);
      const list = await reloadWorkspaces();
      // 立即切换到新建 workspace 并刷新
      applyWorkspace(findWs(list, created.id) ?? created, list);
      setTab("issue");
      WKApp.routeRight.replaceToRoot(<IssuePage />);
      Toast.success(t("loop.workspace.created"));
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
        <Dropdown render={wsMenu} trigger="click" position="bottomLeft">
          <button className="loop-sidebar__ws-btn">
            <Avatar size="extra-extra-small" color="blue" shape="square">{(current?.name ?? "L").slice(0, 1)}</Avatar>
            <span className="loop-sidebar__ws-name">{current?.name ?? (loaded && !hasWs ? t("loop.workspace.none") : t("loop.menu.title"))}</span>
            <ChevronDown size={14} style={{ opacity: 0.5 }} />
          </button>
        </Dropdown>
      </div>

      {!hasWs && loaded ? (
        <div className="loop-sidebar__new">
          <Button theme="solid" block icon={<FolderPlus size={14} />} onClick={openCreateWs}>{t("loop.workspace.create")}</Button>
        </div>
      ) : (
        <>
          <div className="loop-sidebar__new">
            <button className="loop-sidebar__new-btn" onClick={() => setNewIssueOpen(true)}>
              <SquarePen size={15} />
              <span>{t("loop.action.newIssue")}</span>
              <Plus size={14} style={{ marginLeft: "auto", opacity: 0.5 }} />
            </button>
          </div>
          <nav className="loop-sidebar__menu">
            {TABS.map((it) => (
              <button key={it.key} className={`loop-sidebar__item ${tab === it.key ? "is-active" : ""}`} onClick={() => openTab(it.key)}>
                {it.icon}
                <span>{t(`loop.nav.${it.key}`)}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <CreateIssueModal visible={newIssueOpen} onClose={() => setNewIssueOpen(false)} onCreated={() => openTab("issue")} />

      <Modal
        title={t("loop.workspace.create")}
        visible={wsModalOpen}
        onOk={doCreateWs}
        onCancel={() => setWsModalOpen(false)}
        okText={t("loop.action.create")}
        cancelText={t("loop.action.cancel")}
        okButtonProps={{ loading: wsBusy }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="loop-detail__section-title">{t("loop.settings.wsName")}</div>
            <Input autoFocus value={wsName} onChange={(v) => { setWsName(v); if (!wsSlugTouched) setWsSlug(slugify(v)); }} />
          </div>
          <div>
            <div className="loop-detail__section-title">{t("loop.settings.wsSlug")}</div>
            <Input value={wsSlug} onChange={(v) => { setWsSlug(v); setWsSlugTouched(true); }} placeholder="my-workspace" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
