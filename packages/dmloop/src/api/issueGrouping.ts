import type { Issue, IssueGroup } from "./types";

// 把平铺 issue 列表(全文搜索结果)按负责人聚成分组板所需的 IssueGroup[]。用于分组视图的
// 关键词搜索:搜索端点只返回平铺结果,前端按 (assignee_type, assignee_id) 分组,组头名/头像取
// 自已 enrich 的 issue 字段;未指派项归入一个空负责人组。保持首次出现顺序(即搜索相关性序)。
export function groupIssuesByAssignee(issues: Issue[]): IssueGroup[] {
  const order: string[] = [];
  const map = new Map<string, IssueGroup>();
  for (const i of issues) {
    const key = `${i.assignee_type ?? "_"}::${i.assignee_id ?? "_"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        id: key,
        assignee_type: i.assignee_type ?? null,
        assignee_id: i.assignee_id ?? null,
        assignee_name: i.assignee_name ?? null,
        assignee_avatar: i.assignee_avatar ?? null,
        issues: [],
        total: 0,
      };
      map.set(key, g);
      order.push(key);
    }
    g.issues.push(i);
  }
  for (const g of map.values()) g.total = g.issues.length;
  return order.map((k) => map.get(k)!);
}
