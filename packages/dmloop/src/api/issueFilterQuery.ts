import type { ListParams } from "./types";

// 数组/布尔筛选参 → 查询串(逗号连接数组、布尔转 "true")。listIssues 与 grouped 共用,防漂移。
// 空数组本地折叠成 undefined(不发空串),契约不再依赖调用方预折叠。纯函数、只依赖类型,便于契约测试。
export type ArrayFilterParams = Pick<ListParams,
  "statuses" | "priorities" | "assignee_types" | "assignee_ids" | "include_no_assignee" |
  "creator_ids" | "project_ids" | "include_no_project" | "label_ids">;

const csv = (a?: string[]): string | undefined => (a && a.length ? a.join(",") : undefined);

export function arrayFilterQuery(p: ArrayFilterParams): Record<string, string | undefined> {
  return {
    statuses: csv(p.statuses),
    priorities: csv(p.priorities),
    assignee_types: csv(p.assignee_types),
    assignee_ids: csv(p.assignee_ids),
    include_no_assignee: p.include_no_assignee ? "true" : undefined,
    creator_ids: csv(p.creator_ids),
    project_ids: csv(p.project_ids),
    include_no_project: p.include_no_project ? "true" : undefined,
    label_ids: csv(p.label_ids),
  };
}
