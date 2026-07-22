import { useEffect, useState } from "react";
import type { AssigneeCandidate } from "../api/types";
import { listAssigneeCandidates } from "../api/issueApi";

/** 加载 assignee 候选（member/agent/squad）。底层 directory 已做缓存，多处调用不重复拉网。 */
export function useAssigneeCandidates(enabled = true): AssigneeCandidate[] {
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  useEffect(() => {
    if (!enabled) { setCands([]); return; }
    listAssigneeCandidates().then(setCands).catch(() => setCands([]));
  }, [enabled]);
  return cands;
}
