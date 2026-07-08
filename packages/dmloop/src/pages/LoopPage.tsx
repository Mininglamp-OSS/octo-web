import React, { useEffect, useState } from "react";
import { Typography } from "@douyinfe/semi-ui";
import {
  ClipboardList,
  Sparkles,
  Briefcase,
  Bot,
  Users,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import IssuePage from "./IssuePage";
import SkillPage from "./SkillPage";
import ProjectPage from "./ProjectPage";
import AgentPage from "./AgentPage";
import SquadPage from "./SquadPage";
import "./loop.css";

const { Title } = Typography;

type TabKey = "issue" | "skill" | "project" | "agent" | "squad";

const TABS: { key: TabKey; icon: React.ReactNode; render: () => JSX.Element }[] = [
  { key: "issue", icon: <ClipboardList size={16} />, render: () => <IssuePage /> },
  { key: "skill", icon: <Sparkles size={16} />, render: () => <SkillPage /> },
  { key: "project", icon: <Briefcase size={16} />, render: () => <ProjectPage /> },
  { key: "agent", icon: <Bot size={16} />, render: () => <AgentPage /> },
  { key: "squad", icon: <Users size={16} />, render: () => <SquadPage /> },
];

/**
 * LoopPage — Loop 一级面板的**左栏**（二级菜单）。
 * 选中的子模块页面通过 WKApp.routeRight 推入右侧主栏，形成三栏结构：
 * NavRail(应用导航) + 二级菜单(左) + 子模块主内容(右主栏)。
 */
export default function LoopPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("issue");

  const openTab = (key: TabKey) => {
    setTab(key);
    const target = TABS.find((it) => it.key === key);
    if (target) WKApp.routeRight.replaceToRoot(target.render());
  };

  // 进入 Loop 默认打开 Issue 主面板到右栏（延迟一帧确保右栏 route context 已挂载）。
  useEffect(() => {
    const timer = setTimeout(() => {
      WKApp.routeRight.replaceToRoot(<IssuePage />);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="loop-sidebar">
      <div className="loop-sidebar__brand">
        <Title heading={5} style={{ margin: 0 }}>
          {t("loop.menu.title")}
        </Title>
      </div>
      <nav className="loop-sidebar__menu">
        {TABS.map((it) => (
          <button
            key={it.key}
            className={`loop-sidebar__item ${tab === it.key ? "is-active" : ""}`}
            onClick={() => openTab(it.key)}
          >
            {it.icon}
            <span>{t(`loop.nav.${it.key}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
