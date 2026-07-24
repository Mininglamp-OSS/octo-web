import { useEffect, useState } from "react";
import type { AssigneeCandidate } from "../api/types";
import { listAssigneeCandidateState } from "../api/issueApi";

export interface AssigneeCandidateState {
  candidates: AssigneeCandidate[];
  loaded: boolean;
  succeeded: boolean;
}

export function useAssigneeCandidateState(enabled = true): AssigneeCandidateState {
  const [state, setState] = useState<AssigneeCandidateState>({
    candidates: [],
    loaded: !enabled,
    succeeded: !enabled,
  });
  useEffect(() => {
    let alive = true;
    if (!enabled) {
      setState({ candidates: [], loaded: true, succeeded: true });
      return () => { alive = false; };
    }
    setState((prev) => ({ candidates: prev.candidates, loaded: false, succeeded: false }));
    listAssigneeCandidateState()
      .then(({ candidates, succeeded }) => { if (alive) setState({ candidates, loaded: true, succeeded }); })
      .catch(() => {
        if (alive) {
          setState((prev) => ({
            candidates: prev.candidates,
            loaded: true,
            succeeded: false,
          }));
        }
      });
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

/** 加载 assignee 候选（member/agent/squad）。底层 directory 已做缓存，多处调用不重复拉网。 */
export function useAssigneeCandidates(enabled = true): AssigneeCandidate[] {
  return useAssigneeCandidateState(enabled).candidates;
}
