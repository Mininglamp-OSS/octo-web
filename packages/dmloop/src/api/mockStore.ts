// @octo/loop — 内存可变 Mock Store
// MSW handlers 读写此 store；写操作（拖拽改状态、评论增删、改 assignee、字段编辑）会话内闭环可见。
import type {
  Issue,
  IssueComment,
  AgentTask,
  Skill,
  Project,
  Agent,
  Squad,
  Workspace,
} from "./types";
import {
  seedIssues,
  seedComments,
  seedTasks,
  seedSkills,
  seedProjects,
  seedAgents,
  seedSquads,
  seedWorkspaces,
  seedAgentEnv,
} from "./mock/seed";

interface LoopStore {
  issues: Issue[];
  comments: IssueComment[];
  tasks: AgentTask[];
  skills: Skill[];
  projects: Project[];
  agents: Agent[];
  squads: Squad[];
  workspaces: Workspace[];
  agentEnv: Record<string, Record<string, string>>;
}

export const store: LoopStore = {
  issues: seedIssues(),
  comments: seedComments(),
  tasks: seedTasks(),
  skills: seedSkills(),
  projects: seedProjects(),
  agents: seedAgents(),
  squads: seedSquads(),
  workspaces: seedWorkspaces(),
  agentEnv: seedAgentEnv(),
};

let seq = 1000;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
