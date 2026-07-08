import React, { useEffect, useState } from "react";
import { Typography, Dropdown, Avatar } from "@douyinfe/semi-ui";
import {
  ClipboardList,
  Sparkles,
  Briefcase,
  Bot,
  Users,
  ChevronDown,
  Check,
  Plus,
  SquarePen,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Workspace } from "../api/types";
import { listWorkspaces } from "../api/workspaceApi";
import { setWorkspaceId, currentWorkspaceId } from "../api/http";
import CreateIssueModal from "../ui/CreateIssueModal";
import IssuePage from "./IssuePage";
import SkillPage from "./SkillPage";
import ProjectPage from "./ProjectPage";
import AgentPage from "./AgentPage";
import SquadPage from "./SquadPage";
import "./loop.css";

const { Title, Text } = Typography;

type TabKey = "issue" | "skill" | "project" | "agent" | "squad";

const TABS: { key: TabKey; icon: React.ReactNode; render: () => JSX.Element }[] = [
  { key: "issue", icon: <ClipboardList size={16} />, render: () => <IssuePage /> },
  { key: "skill", icon: <Sparkles size={16} />, render: () => <SkillPage /> },
  { key: "project", icon: <Briefcase size={16} />, render: () => <ProjectPage /> },
  { key: "agent", icon: <Bot size={16} />, render: () => <AgentPage /> },
  { key: "squad", icon: <Users size={16} />, render: () => <SquadPage /> },
];

/**
 * LoopPage — Loop 一级面板左栏：workspace 选择器 + 新建入口 + 二级菜单。
 * 子模块主内容通过 WKApp.routeRight 推入右主栏（三栏结构）。
 */
export default function LoopPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("issue");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string>(currentWorkspaceId());
  const [newOpen, setNewOpen] = useState(false);

  const openTab = (key: TabKey) => {
    setTab(key);
    const target = TABS.find((it) => it.key === key);
    if (target) WKApp.routeRight.replaceToRoot(target.render());
  };

  useEffect(() => {
    listWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (!ws.some((w) => w.id === currentWorkspaceId()) && ws[0]) {
        setWorkspaceId(ws[0].id);
        setWsId(ws[0].id);
      }
    });
    const timer = setTimeout(() => WKApp.routeRight.replaceToRoot(<IssuePage />), 0);
    return () => clearTimeout(timer);
  }, []);

  const switchWorkspace = (id: string) => {
    setWorkspaceId(id);
    setWsId(id);
    // 切换 workspace 后重载当前子模块（数据按 workspace_id 过滤）。
    const target = TABS.find((it) => it.key === tab);
    if (target) WKApp.routeRight.replaceToRoot(target.render());
  };

  const current = workspaces.find((w) => w.id === wsId);

  const wsMenu = (
    <Dropdown.Menu>
      <Dropdown.Title>{t("loop.workspace.title")}</Dropdown.Title>
      {workspaces.map((w) => (
        <Dropdown.Item
          key={w.id}
          onClick={() => switchWorkspace(w.id)}
          icon={
            <Avatar size="extra-extra-small" color={(w.avatar_color as never) ?? "blue"} shape="square">
              {w.name.slice(0, 1)}
            </Avatar>
          }
        >
          <span style={{ flex: 1 }}>{w.name}</span>
          {w.id === wsId && <Check size={14} />}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  return (
    <div className="loop-sidebar">
      <div className="loop-sidebar__ws">
        <Dropdown render={wsMenu} trigger="click" position="bottomLeft">
          <button className="loop-sidebar__ws-btn">
            <Avatar size="extra-extra-small" color={(current?.avatar_color as never) ?? "blue"} shape="square">
              {(current?.name ?? "L").slice(0, 1)}
            </Avatar>
            <span className="loop-sidebar__ws-name">{current?.name ?? t("loop.menu.title")}</span>
            <ChevronDown size={14} style={{ opacity: 0.5 }} />
          </button>
        </Dropdown>
      </div>

      <div className="loop-sidebar__new">
        <button className="loop-sidebar__new-btn" onClick={() => setNewOpen(true)}>
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

      <CreateIssueModal
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => openTab("issue")}
      />
    </div>
  );
}
