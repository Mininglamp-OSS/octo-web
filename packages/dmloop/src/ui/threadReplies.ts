import type { IssueComment } from "../api/types";

/**
 * Index replies by parent_id once. A page that renders many thread roots can
 * build this map a single time and pass it to collectThreadReplies for each
 * root, instead of rescanning every comment per root (was O(roots × comments)).
 */
export function buildRepliesByParent(comments: IssueComment[]): Map<string, IssueComment[]> {
  const byParent = new Map<string, IssueComment[]>();
  for (const c of comments) {
    if (!c.parent_id) continue;
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }
  return byParent;
}

/**
 * Collect every descendant reply of a thread root, flattened in chronological
 * order (created_at ASC, id tie-break). Takes the parent→children index from
 * buildRepliesByParent so callers build it once and reuse it across roots.
 *
 * A thread is not always two levels deep: an agent reply is stored with its
 * `parent_id` pointing at the specific comment that triggered it (a member's
 * @mention), not at the thread root. So a member question sits one level under
 * the root while the agent's answer sits one level under that member question —
 * a grandchild. Taking only direct children of the root drops every agent reply
 * from the view even though the API returned them. Walking the whole subtree
 * keeps replies at any depth, and flattening chronologically renders the
 * back-and-forth (member ask → agent answer) in the order it happened.
 */
export function collectThreadReplies(
  rootId: string,
  repliesByParent: Map<string, IssueComment[]>,
): IssueComment[] {
  const out: IssueComment[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const child of repliesByParent.get(id) ?? []) {
      // Guard against a parent_id cycle (self- or mutual reference): a bad
      // write must not spin the render into an infinite loop.
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      walk(child.id);
    }
  };
  walk(rootId);

  return out.sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
