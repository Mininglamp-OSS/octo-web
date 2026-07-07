// @octo/loop — 内存可变 Mock Store
// 写操作（拖拽改状态、评论增删、改 assignee、字段编辑）作用于此 store，会话内闭环可见。
import type { Issue, IssueComment, Skill, Project, Agent, Squad } from "./types";
import {
  seedIssues,
  seedComments,
  seedSkills,
  seedProjects,
  seedAgents,
  seedSquads,
} from "./mock/seed";

interface LoopStore {
  issues: Issue[];
  comments: IssueComment[];
  skills: Skill[];
  projects: Project[];
  agents: Agent[];
  squads: Squad[];
}

// 单例，模块级持久（HMR 下每次重载重置为种子数据即可）。
export const store: LoopStore = {
  issues: seedIssues(),
  comments: seedComments(),
  skills: seedSkills(),
  projects: seedProjects(),
  agents: seedAgents(),
  squads: seedSquads(),
};

let seq = 1000;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function sleep(ms = 160): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 深拷贝，避免调用方直接持有 store 内部引用。 */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
