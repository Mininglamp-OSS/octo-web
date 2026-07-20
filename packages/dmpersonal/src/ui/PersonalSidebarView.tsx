import React from "react";
import type { PersonalTabKey } from "../bridge/types";

export interface PersonalSidebarTab {
  key: PersonalTabKey;
  icon: React.ReactNode;
  label: string;
}

export interface PersonalSidebarViewProps {
  title: string;
  betaLabel: string;
  tabs: PersonalSidebarTab[];
  activeTab: PersonalTabKey;
  workspaceReady: boolean;
  machineMode: boolean;
  workspaceError: string | null;
  onTabClick: (key: PersonalTabKey) => void;
}

export default function PersonalSidebarView({
  title,
  betaLabel,
  tabs,
  activeTab,
  workspaceReady,
  machineMode,
  workspaceError,
  onTabClick,
}: PersonalSidebarViewProps) {
  return (
    <div className="dmpersonal-sidebar">
      <div className="dmpersonal-sidebar__title">
        <span>{title}</span>
        <span className="dmpersonal-sidebar__beta">{betaLabel}</span>
      </div>
      <nav className="dmpersonal-sidebar__menu">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`dmpersonal-sidebar__item ${
              activeTab === item.key ? "is-active" : ""
            }`}
            disabled={!workspaceReady || (machineMode && item.key === "skill")}
            onClick={() => onTabClick(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {workspaceError && (
        <div className="dmpersonal-sidebar__hint">{workspaceError}</div>
      )}
    </div>
  );
}
