import { useEffect, useRef, useState } from "react";
import type { CommentTriggerAgent } from "../api/types";
import { previewCommentTriggers } from "../api/issueApi";

const DEBOUNCE_MS = 300;
// member/agent/squad/all mentions drive the wake set; issue mentions are cross-refs, not triggers.
const MENTION_RE = /\[@?(.+?)\]\(mention:\/\/(member|agent|squad|issue|all)\/([0-9a-fA-F-]+|all)\)/g;

// Stable signature of the draft's wake-relevant shape: "empty" when there is nothing to send,
// else "nonempty" + the sorted mention set (issue mentions excluded). The preview only
// re-fetches when this changes — plain typing without a mention change never hits the server,
// and clearing the draft returns [] instantly so no stale in-flight response can revive the chip.
function signatureOf(content: string): string {
  if (!content.trim()) return "empty";
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    const type = m[2];
    const id = m[3];
    if (!type || !id || type === "issue") continue;
    seen.add(`${type}:${id}`);
  }
  return `nonempty|${[...seen].sort().join(",")}`;
}

/** Which agents this comment/reply will wake on send (issue assignee + @-mentioned agents). */
export function useCommentTriggerPreview(issueId: string, content: string, parentId: string | null): CommentTriggerAgent[] {
  const [agents, setAgents] = useState<CommentTriggerAgent[]>([]);
  const contentRef = useRef(content);
  contentRef.current = content;
  const sig = signatureOf(content);
  useEffect(() => {
    if (sig === "empty") { setAgents([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewCommentTriggers(issueId, contentRef.current, parentId)
        .then((a) => { if (!cancelled) setAgents(a); })
        .catch(() => { if (!cancelled) setAgents([]); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [issueId, parentId, sig]);
  return sig === "empty" ? [] : agents;
}
