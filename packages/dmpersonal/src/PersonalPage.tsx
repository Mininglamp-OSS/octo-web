import React from "react";
import { Cpu, Sparkles } from "lucide-react";
import { RuntimePage, SkillPage } from "@octo/loop";
import { useI18n } from "@octo/base";
import {
  type PersonalTabKey,
  usePersonalWorkspace,
} from "./bridge/usePersonalWorkspace";
import PersonalSidebarView from "./ui/PersonalSidebarView";
import PersonalWorkspaceState from "./ui/PersonalWorkspaceState";
import "@octo/loop/src/pages/loop.css";
import "./personal.css";

function renderTab(key: PersonalTabKey): JSX.Element {
  switch (key) {
    case "runtime":
      return <RuntimePage key="runtime" />;
    case "skill":
      return <SkillPage key="skill" />;
    default:
      return <RuntimePage key="runtime" />;
  }
}

export default function PersonalPage() {
  const { t } = useI18n();
  const { tab, workspaceReady, workspaceError, machineMode, openTab } =
    usePersonalWorkspace({
      t,
      renderTab,
      renderWorkspaceState: (state) => <PersonalWorkspaceState {...state} />,
    });

  const tabs = [
    {
      key: "runtime" as const,
      icon: <Cpu size={16} />,
      label: t("personal.nav.runtime"),
    },
    {
      key: "skill" as const,
      icon: <Sparkles size={16} />,
      label: t("personal.nav.skill"),
    },
  ];

  return (
    <PersonalSidebarView
      title={t("personal.menu.title")}
      betaLabel={t("personal.beta")}
      tabs={tabs}
      activeTab={tab}
      workspaceReady={workspaceReady}
      machineMode={machineMode}
      workspaceError={workspaceError}
      onTabClick={openTab}
    />
  );
}
