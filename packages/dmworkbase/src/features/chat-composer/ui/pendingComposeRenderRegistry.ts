import type { ReactNode } from "react";

export interface PendingComposeRenderContext<TAttachment> {
  sendingLabel: string;
  renderAttachment: (attachment: TAttachment) => ReactNode;
}

export interface PendingComposeRenderer<TItem, TAttachment> {
  id: string;
  priority?: number;
  canRender: (item: TItem) => boolean;
  render: (
    item: TItem,
    context: PendingComposeRenderContext<TAttachment>,
  ) => ReactNode;
}

/** Registry for pending-send UI. The composer owns layout; extensions own content. */
export class PendingComposeRenderRegistry<TItem, TAttachment> {
  private readonly renderers = new Map<
    string,
    PendingComposeRenderer<TItem, TAttachment>
  >();

  register(renderer: PendingComposeRenderer<TItem, TAttachment>): void {
    if (this.renderers.has(renderer.id)) {
      throw new Error(`pending compose renderer already registered: ${renderer.id}`);
    }
    this.renderers.set(renderer.id, renderer);
  }

  unregister(id: string): boolean {
    return this.renderers.delete(id);
  }

  render(
    item: TItem,
    context: PendingComposeRenderContext<TAttachment>,
  ): ReactNode {
    const renderer = [...this.renderers.values()]
      .filter((candidate) => candidate.canRender(item))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
    return renderer?.render(item, context) ?? null;
  }

  clear(): void {
    this.renderers.clear();
  }
}
