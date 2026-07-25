import React from "react";
import { Avatar, Dropdown } from "@douyinfe/semi-ui";
import {
  Check,
  ChevronDown,
  FolderPlus,
  Plus,
  SquarePen,
} from "lucide-react";
import type { Workspace } from "../api/types";
import type { LoopTabItem, LoopTabKey } from "../bridge/types";
import LoopButton from "./LoopButton";

export interface LoopSidebarLabels {
  title: string;
  workspaceTitle: string;
  noWorkspace: string;
  createWorkspace: string;
  newIssue: string;
  workspaceGroup: string;
}

export interface LoopSidebarViewProps {
  activeTab: LoopTabKey;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  hasWorkspace: boolean;
  loaded: boolean;
  myTab: LoopTabItem;
  workspaceTabs: LoopTabItem[];
  settingsTab: LoopTabItem;
  labels: LoopSidebarLabels;
  onTabClick: (key: LoopTabKey) => void;
  onNewLoop: () => void;
  onCreateWorkspace: () => void;
  onSwitchWorkspace: (workspace: Workspace) => void;
}

export default function LoopSidebarView({
  activeTab,
  workspaces,
  currentWorkspace,
  hasWorkspace,
  loaded,
  myTab,
  workspaceTabs,
  settingsTab,
  labels,
  onTabClick,
  onNewLoop,
  onCreateWorkspace,
  onSwitchWorkspace,
}: LoopSidebarViewProps) {
  const workspaceName =
    currentWorkspace?.name ?? (loaded && !hasWorkspace ? labels.noWorkspace : labels.title);
  const workspaceInitial = (currentWorkspace?.name ?? "L").slice(0, 1);
  const workspaceMenu = (
    <Dropdown.Menu>
      <Dropdown.Title>{labels.workspaceTitle}</Dropdown.Title>
      {workspaces.map((workspace) => (
        <Dropdown.Item
          key={workspace.id}
          onClick={() => onSwitchWorkspace(workspace)}
          icon={
            <Avatar size="extra-extra-small" color="blue" shape="square">
              {workspace.name.slice(0, 1)}
            </Avatar>
          }
        >
          <span className="loop-sidebar__ws-menu-name">{workspace.name}</span>
          {workspace.id === currentWorkspace?.id && <Check size={14} />}
        </Dropdown.Item>
      ))}
      <Dropdown.Divider />
      <Dropdown.Item icon={<FolderPlus size={14} />} onClick={onCreateWorkspace}>
        {labels.createWorkspace}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <div className="loop-sidebar">
      <div className="loop-sidebar__ws">
        <Dropdown
          render={workspaceMenu}
          trigger="click"
          position="bottomLeft"
          clickToHide
        >
          <button className="loop-sidebar__ws-btn">
            <Avatar size="extra-extra-small" color="blue" shape="square">
              {workspaceInitial}
            </Avatar>
            <span className="loop-sidebar__ws-name">{workspaceName}</span>
            <ChevronDown size={14} style={{ opacity: 0.5 }} />
          </button>
        </Dropdown>
      </div>

      {!hasWorkspace && loaded ? (
        <div className="loop-sidebar__new">
          <LoopButton
            block
            icon={<FolderPlus size={14} />}
            onClick={onCreateWorkspace}
          >
            {labels.createWorkspace}
          </LoopButton>
        </div>
      ) : (
        <>
          <div className="loop-sidebar__new">
            <button className="loop-sidebar__new-btn" onClick={onNewLoop}>
              <SquarePen size={15} />
              <span>{labels.newIssue}</span>
              <Plus size={14} className="loop-sidebar__new-plus" />
            </button>
          </div>
          <nav className="loop-sidebar__menu">
            <button
              className={`loop-sidebar__item ${
                activeTab === myTab.key ? "is-active" : ""
              }`}
              onClick={() => onTabClick(myTab.key)}
            >
              {myTab.icon}
              <span>{myTab.label}</span>
            </button>
            <div className="loop-sidebar__group-label">
              {labels.workspaceGroup}
            </div>
            {workspaceTabs.map((item) => (
              <button
                key={item.key}
                className={`loop-sidebar__item ${
                  activeTab === item.key ? "is-active" : ""
                }`}
                onClick={() => onTabClick(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
            <button
              className={`loop-sidebar__item ${
                activeTab === settingsTab.key ? "is-active" : ""
              }`}
              onClick={() => onTabClick(settingsTab.key)}
            >
              {settingsTab.icon}
              <span>{settingsTab.label}</span>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
