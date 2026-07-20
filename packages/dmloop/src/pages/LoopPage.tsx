import React from "react";
import {
  Bot,
  Briefcase,
  CircleUserRound,
  ClipboardList,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { useI18n } from "@octo/base";
import type { Workspace } from "../api/types";
import type { LoopTabItem, LoopTabKey } from "../bridge/types";
import { useLoopWorkspace } from "../bridge/useLoopWorkspace";
import CreateIssueModal from "../ui/CreateIssueModal";
import LoopCreateWorkspaceModal from "../ui/LoopCreateWorkspaceModal";
import LoopSidebarView from "../ui/LoopSidebarView";
import LoopWorkspaceEmptyState from "../ui/LoopWorkspaceEmptyState";
import AgentPage from "./AgentPage";
import AutomationPage from "./AutomationPage";
import IssueDetailPage from "../panel/IssueDetailPage";
import IssuePage from "./IssuePage";
import ProjectPage from "./ProjectPage";
import SettingsPage from "./SettingsPage";
import SquadPage from "./SquadPage";
import "./loop.css";
import "../ui/loopControls.css";

export default function LoopPage() {
  const { t } = useI18n();

  const renderTab = (
    key: LoopTabKey,
    workspace: Workspace | null,
    helpers: { reloadWorkspaces: () => Promise<Workspace[]> }
  ): JSX.Element => {
    // 以「当前 workspace」为 key 驱动整颗子页面：切换 workspace → key 变化 → React 强制
    // 重挂子页面 → useEffect 重新以新的 x-workspace-slug 拉取数据，避免残留旧 workspace 数据。
    const tabKey = `${key}:${workspace?.id ?? "none"}`;
    switch (key) {
      case "myloop":
        return (
          <IssuePage
            key={tabKey}
            viewKey="loop.view.myloop"
            defaultView="grouped"
            defaultScope="involves"
          />
        );
      case "issue":
        return <IssuePage key={tabKey} viewKey="loop.view.issue" />;
      case "project":
        return <ProjectPage key={tabKey} />;
      case "automation":
        return <AutomationPage key={tabKey} />;
      case "agent":
        return <AgentPage key={tabKey} />;
      case "squad":
        return <SquadPage key={tabKey} />;
      case "settings":
        return (
          <SettingsPage
            key={tabKey}
            workspace={workspace}
            onUpdated={helpers.reloadWorkspaces}
          />
        );
      default:
        return <IssuePage key={tabKey} viewKey="loop.view.issue" />;
    }
  };

  const loop = useLoopWorkspace({
    t,
    renderTab,
    renderIssueDetail: (issueId, helpers) => (
      <IssueDetailPage
        key={`issue-detail:${issueId}`}
        issueId={issueId}
        onChanged={helpers.onIssueChanged}
        onClose={helpers.onClose}
      />
    ),
    renderEmptyGuide: () => (
      <LoopWorkspaceEmptyState
        title={t("loop.workspace.emptyTitle")}
        desc={t("loop.workspace.emptyDesc")}
      />
    ),
  });

  const myTab: LoopTabItem = {
    key: "myloop",
    icon: <CircleUserRound size={16} />,
    label: t("loop.nav.myloop"),
  };
  const workspaceTabs: LoopTabItem[] = [
    {
      key: "issue",
      icon: <ClipboardList size={16} />,
      label: t("loop.nav.issue"),
    },
    {
      key: "project",
      icon: <Briefcase size={16} />,
      label: t("loop.nav.project"),
    },
    {
      key: "automation",
      icon: <Zap size={16} />,
      label: t("loop.nav.automation"),
    },
    {
      key: "agent",
      icon: <Bot size={16} />,
      label: t("loop.nav.agent"),
    },
    {
      key: "squad",
      icon: <Users size={16} />,
      label: t("loop.nav.squad"),
    },
  ];
  const settingsTab: LoopTabItem = {
    key: "settings",
    icon: <Settings size={16} />,
    label: t("loop.nav.settings"),
  };

  return (
    <>
      <LoopSidebarView
        activeTab={loop.tab}
        workspaces={loop.workspaces}
        currentWorkspace={loop.currentWorkspace}
        hasWorkspace={loop.hasWorkspace}
        loaded={loop.loaded}
        myTab={myTab}
        workspaceTabs={workspaceTabs}
        settingsTab={settingsTab}
        labels={{
          title: t("loop.menu.title"),
          workspaceTitle: t("loop.workspace.title"),
          noWorkspace: t("loop.workspace.none"),
          createWorkspace: t("loop.workspace.create"),
          newIssue: t("loop.action.newIssue"),
          workspaceGroup: t("loop.nav.workspaceGroup"),
        }}
        onTabClick={loop.openTab}
        onNewLoop={loop.openNewLoop}
        onCreateWorkspace={loop.openCreateWorkspace}
        onSwitchWorkspace={loop.switchWorkspace}
      />
      <LoopCreateWorkspaceModal
        visible={loop.wsModalOpen}
        busy={loop.wsBusy}
        name={loop.wsName}
        slug={loop.wsSlug}
        labels={{
          title: t("loop.workspace.create"),
          create: t("loop.action.create"),
          cancel: t("loop.action.cancel"),
          name: t("loop.settings.wsName"),
          slug: t("loop.settings.wsSlug"),
          namePlaceholder: t("loop.workspace.namePlaceholder"),
          slugPlaceholder: "my-workspace",
        }}
        onSubmit={loop.submitCreateWorkspace}
        onCancel={loop.closeCreateWorkspace}
        onNameChange={loop.changeWorkspaceName}
        onSlugChange={loop.changeWorkspaceSlug}
      />
      <CreateIssueModal
        visible={loop.createOpen}
        onClose={loop.closeCreateIssue}
        onCreated={loop.handleIssueCreated}
      />
    </>
  );
}
