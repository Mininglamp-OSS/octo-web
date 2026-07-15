import type { ListParams } from "./types";

// 数组/布尔筛选参 → 查询串(逗号连接数组、布尔转 "true")。listIssues 与 grouped 共用,防漂移。
// 空数组由调用方在 reload 里预折叠成 undefined,故此处不发空串。纯函数、只依赖类型,便于契约测试。
export type ArrayFilterParams = Pick<ListParams,
  "statuses" | "priorities" | "assignee_types" | "assignee_ids" | "include_no_assignee" |
  "creator_ids" | "project_ids" | "include_no_project" | "label_ids">;

export function arrayFilterQuery(p: ArrayFilterParams): Record<string, string | undefined> {
  return {
    statuses: p.statuses?.join(","),
    priorities: p.priorities?.join(","),
    assignee_types: p.assignee_types?.join(","),
    assignee_ids: p.assignee_ids?.join(","),
    include_no_assignee: p.include_no_assignee ? "true" : undefined,
    creator_ids: p.creator_ids?.join(","),
    project_ids: p.project_ids?.join(","),
    include_no_project: p.include_no_project ? "true" : undefined,
    label_ids: p.label_ids?.join(","),
  };
}
