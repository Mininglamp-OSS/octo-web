import React, { useState } from "react";
import { Typography } from "@douyinfe/semi-ui";
import {
  ClipboardList,
  Sparkles,
  Briefcase,
  Bot,
  Users,
} from "lucide-react";
import { useI18n } from "@octo/base";
import IssuePage from "./IssuePage";
import SkillPage from "./SkillPage";
import ProjectPage from "./ProjectPage";
import AgentPage from "./AgentPage";
import SquadPage from "./SquadPage";
import "./loop.css";

const { Title } = Typography;

type TabKey = "issue" | "skill" | "project" | "agent" | "squad";

const TABS: { key: TabKey; icon: React.ReactNode }[] = [
  { key: "issue", icon: <ClipboardList size={16} /> },
  { key: "skill", icon: <Sparkles size={16} /> },
  { key: "project", icon: <Briefcase size={16} /> },
  { key: "agent", icon: <Bot size={16} /> },
  { key: "squad", icon: <Users size={16} /> },
];

export default function LoopPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("issue");

  return (
    <div className="loop-shell">
      <aside className="loop-shell__nav">
        <div className="loop-shell__brand">
          <Title heading={5} style={{ margin: 0 }}>
            {t("loop.menu.title")}
          </Title>
        </div>
        <nav className="loop-shell__menu">
          {TABS.map((it) => (
            <button
              key={it.key}
              className={`loop-shell__item ${tab === it.key ? "is-active" : ""}`}
              onClick={() => setTab(it.key)}
            >
              {it.icon}
              <span>{t(`loop.nav.${it.key}`)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="loop-shell__content">
        {tab === "issue" && <IssuePage />}
        {tab === "skill" && <SkillPage />}
        {tab === "project" && <ProjectPage />}
        {tab === "agent" && <AgentPage />}
        {tab === "squad" && <SquadPage />}
      </main>
    </div>
  );
}
