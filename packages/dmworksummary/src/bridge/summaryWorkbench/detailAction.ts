import type { SummaryListAction } from "./listActions";

export interface SummaryDetailAction {
  id: number;
  taskId: number;
  spaceId: string;
  action: SummaryListAction;
  contentId?: string;
}

let sequence = 0;
export function createSummaryDetailAction(
  taskId: number, spaceId: string, action: SummaryListAction, contentId?: string,
): SummaryDetailAction {
  return { id: ++sequence, taskId, spaceId, action, contentId };
}

/** In-memory UI intents, never durable commands or URL parameters. */
export class SummaryDetailActionGate {
  private consumed = new Set<number>();

  take(request: SummaryDetailAction | undefined, context: {
    taskId: number | null; spaceId: string; ready: boolean; contentId?: string;
  }): SummaryListAction | undefined {
    if (!request || this.consumed.has(request.id)) return undefined;
    if (request.spaceId !== context.spaceId) {
      this.consumed.add(request.id);
      return undefined;
    }
    if (!context.ready || request.taskId !== context.taskId) return undefined;
    this.consumed.add(request.id);
    if (request.contentId && request.contentId !== context.contentId) return undefined;
    return request.action;
  }
}
