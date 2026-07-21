import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { getPinyin, WKApp } from "@octo/base";
import type { AssigneeCandidate, Issue } from "../api/types";
import { searchIssues, listIssues } from "../api/issueApi";
import { agentStatusMap } from "../api/agentApi";
import { currentWorkspaceId } from "../api/http";
import { ISSUE_STATUS_HEX } from "./meta";
import { getRecencyMap, recordMentionUsage, sortByRecency, capPerType } from "./mentionRecency";
import { createMentionMenu, type LoopMentionItem, type MentionMenuLabels } from "./suggestionMenu";

// Browse (empty @) shows a few per type; experts/expert-teams reveal all via
// "show more" (small sets), members/tasks fall back to search (large sets).
const MAX_SEARCH_PER_TYPE = 10; // per actor type when a query is typed — no type crowded out by another's volume
const MAX_ISSUE_BROWSE = 51; // recent tasks on empty @ (menu shows up to 50 + a "search" hint past that)
const MAX_ISSUE_SEARCH = 20; // task matches when a query is typed

export interface MentionExtLabels extends MentionMenuLabels {
  allMembers: string;
}

/** Escape label brackets so they can't break the `[label](url)` markdown link. */
function safeLabel(label: string): string {
  return String(label).replace(/[[\]]/g, "");
}

/** issue/project mentions carry no "@" prefix (backend token contract). */
function tokenPrefix(type: string): string {
  return type === "issue" || type === "project" ? "" : "@";
}

export function mentionToToken(attrs: { id: string; label: string; type: string }): string {
  return `[${tokenPrefix(attrs.type)}${safeLabel(attrs.label)}](mention://${attrs.type}/${attrs.id})`;
}

/** In-editor display text: "@Name" for actors, bare identifier for issue/project. */
function displayLabel(attrs: { type?: string; label?: string; id?: string }): string {
  return `${tokenPrefix(attrs.type ?? "member")}${attrs.label ?? attrs.id ?? ""}`;
}

// Cache pinyin per name: nameMatches runs over the full candidate list on every
// keystroke and getPinyin is a char-by-char table scan; names don't change.
const pinyinCache = new Map<string, string>();
function pinyinOf(name: string): string {
  let p = pinyinCache.get(name);
  if (p === undefined) {
    p = getPinyin(name).toLowerCase();
    pinyinCache.set(name, p);
  }
  return p;
}

/** Match by name substring or pinyin so Chinese names are reachable by their romanization. */
function nameMatches(name: string, q: string): boolean {
  if (!q) return true;
  return name.toLowerCase().includes(q) || pinyinOf(name).includes(q);
}

function toIssueItem(i: Issue): LoopMentionItem {
  return {
    id: i.id,
    label: i.identifier,
    type: "issue",
    description: i.title ?? undefined,
    statusHex: ISSUE_STATUS_HEX[i.status],
    statusFilled: i.status === "done",
  };
}

/**
 * Agent status → mention-avatar dot color. Returns the shared `--dot-*` CSS variables
 * (defined in loop.css) so this path can never drift from `.loop-status-dot`. Color-only:
 * the 7px mention dot stays solid by design (no hollow ring / pulse), only agent statuses
 * apply (squad-only unstable/archived never reach here), and a missing/loading status
 * returns undefined so no dot renders until the async status map fills.
 */
function agentDotColor(status: string | undefined): string | undefined {
  switch (status) {
    case "idle":
      return "var(--dot-idle)";
    case "working":
      return "var(--dot-working)";
    case "error":
      return "var(--dot-error)";
    case "offline":
      return "var(--dot-offline)";
    default:
      return undefined;
  }
}

/**
 * @-mention node for the comment composer. Inserts a chip { id, label, type } that the
 * composer serializes back to the backend token via mentionToToken. Sources: all-members,
 * workspace members/agents/squads (candidates), and issues (recent on empty query, full-text
 * search otherwise). Large lists: query+pinyin filter, per-source cap, popup scroll.
 */
export function buildLoopMention(getCandidates: () => AssigneeCandidate[], labels: MentionExtLabels) {
  let queryToken = 0;
  // Agent online status isn't on the candidates; read the shared cached map (one /agents
  // per page, not one per composer) and join by id. Fills async → dots appear once loaded.
  let agentStatus: Map<string, string> = new Map();
  agentStatusMap().then((m) => { agentStatus = m; });
  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        type: {
          default: "member",
          parseHTML: (el: HTMLElement) => el.getAttribute("data-mention-type") || "member",
          renderHTML: (attrs: { type?: string }) => ({ "data-mention-type": attrs.type || "member" }),
        },
      };
    },
    // issue/project chips render without the "@" prefix in the editor too, not just in
    // the serialized token.
    renderHTML({ node, HTMLAttributes }) {
      const type = node.attrs.type ?? "member";
      return [
        "span",
        mergeAttributes({ "data-type": "mention" }, this.options.HTMLAttributes, HTMLAttributes, {
          "data-mention-type": type,
          "data-mention-id": node.attrs.id,
        }),
        displayLabel(node.attrs),
      ];
    },
  }).configure({
    HTMLAttributes: { class: "loop-mention" },
    renderText({ node }) {
      return displayLabel(node.attrs);
    },
    suggestion: {
      items: async ({ query }: { query: string }): Promise<LoopMentionItem[]> => {
        const token = ++queryToken;
        const q = query.trim().toLowerCase();
        const wsId = currentWorkspaceId();
        const recency = getRecencyMap(wsId);
        const all: LoopMentionItem[] =
          "all".includes(q) || nameMatches(labels.allMembers, q)
            ? [{ id: "all", label: labels.allMembers, type: "all" }]
            : [];
        // Merge all three types into one recency-ranked list; the popup then
        // groups by type (browse) or keeps it flat (search). Replaces the old
        // members-first + slice(10) that buried experts in large workspaces.
        const ranked = sortByRecency(
          getCandidates()
            .filter((c) => nameMatches(c.name, q))
            .map((c) => ({
              id: c.id,
              label: c.name,
              type: c.type,
              avatarUrl: c.octo_uid ? WKApp.shared.avatarUser(c.octo_uid) : undefined,
              dotColor: c.type === "agent" ? agentDotColor(agentStatus.get(c.id)) : undefined,
            })),
          recency,
        );
        const users: LoopMentionItem[] = q
          ? capPerType(ranked, MAX_SEARCH_PER_TYPE).map((u) => ({ ...u, group: "search" as const }))
          : ranked;
        // Debounce the per-keystroke issue search (empty "@" fires once, no wait). If the
        // query is superseded mid-flight the promise never resolves, so tiptap never renders
        // this stale call's results (gates the whole result, not just issues).
        const stale = (): Promise<LoopMentionItem[]> => new Promise<LoopMentionItem[]>(() => {});
        let issues: LoopMentionItem[] = [];
        try {
          if (q) {
            await new Promise((r) => setTimeout(r, 200));
            if (token !== queryToken) return stale();
          }
          const r = q
            ? await searchIssues(query.trim(), { limit: MAX_ISSUE_SEARCH, includeClosed: true })
            : await listIssues({ limit: MAX_ISSUE_BROWSE });
          if (token !== queryToken) return stale();
          // Tag search-mode tasks group:"search" too, so the popup treats them as
          // uncapped, reachable matches (not the capped browse "issues" section).
          issues = q
            ? r.issues.map((i) => ({ ...toIssueItem(i), group: "search" as const }))
            : r.issues.map(toIssueItem);
        } catch {
          /* search failure: degrade to users only */
        }
        return [...all, ...users, ...issues];
      },
      render: () =>
        createMentionMenu(labels, (item) => {
          // Only actors are recency-ranked; @all / issue picks would just crowd
          // the capped store and evict real ranking data.
          if (item.type !== "member" && item.type !== "agent" && item.type !== "squad") return;
          const wsId = currentWorkspaceId();
          if (wsId) recordMentionUsage(wsId, item);
        }),
    },
  });
}
