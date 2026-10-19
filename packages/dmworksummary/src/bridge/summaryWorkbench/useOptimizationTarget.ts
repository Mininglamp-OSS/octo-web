import { useEffect, useState } from "react";
import { getSummaryOptimizationTarget } from "../../Service/SummaryWorkbenchService";
import type { SummaryOptimizationContext } from "./protocol";

// Capture the original revision before generation. Recovery must never silently
// refresh this revision: an intervening edit must remain a save conflict.
export function useOptimizationTarget({
  taskId,
  sessionId,
  userId,
  spaceId,
  hasMessages,
}: {
  taskId?: number;
  sessionId: string;
  userId?: string;
  spaceId?: string;
  hasMessages: boolean;
}) {
  const [optimization, setOptimization] =
    useState<SummaryOptimizationContext | null>(null);
  const [loading, setLoading] = useState(Boolean(taskId));
  useEffect(() => {
    let active = true;
    setOptimization(null);
    setLoading(Boolean(taskId));
    const key = `summary-optimization:${userId}:${spaceId}:${sessionId}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SummaryOptimizationContext;
        if (
          (!taskId || parsed.target.task_id === taskId) &&
          typeof parsed.target.expected_revision === "string" &&
          typeof parsed.can_save_version === "boolean"
        ) {
          setOptimization(parsed);
          setLoading(false);
          return;
        }
      }
    } catch {
      /* A recovered session without its base can only save a copy. */
    }
    if (!taskId || hasMessages) {
      setLoading(false);
      return;
    }
    void getSummaryOptimizationTarget(taskId)
      .then((context) => {
        if (!active) return;
        setOptimization(context);
        try {
          localStorage.setItem(key, JSON.stringify(context));
        } catch {
          /* memory remains usable */
        }
      })
      .catch(() => {
        // Do not infer write permission when the target is unavailable.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // hasMessages intentionally excluded: generation never changes the base.
  }, [taskId, sessionId, userId, spaceId]);
  return { optimization, loading };
}
