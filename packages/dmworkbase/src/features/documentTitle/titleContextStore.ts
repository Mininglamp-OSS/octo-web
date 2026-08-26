import type { PageTitleContext } from "./titleRules";

type TitleContextOwner = symbol;
type TitleContextListener = () => void;

interface StoredTitleContext {
  context: PageTitleContext;
  owner?: TitleContextOwner;
}

function contextsEqual(a?: PageTitleContext, b?: PageTitleContext): boolean {
  return (
    a?.primaryTitle === b?.primaryTitle &&
    a?.parentTitle === b?.parentTitle &&
    a?.moduleTitle === b?.moduleTitle
  );
}

export class TitleContextStore {
  private readonly contexts = new Map<string, StoredTitleContext>();
  private readonly listeners = new Set<TitleContextListener>();

  get(menuId: string): PageTitleContext | undefined {
    return this.contexts.get(menuId)?.context;
  }

  set(
    menuId: string,
    context: PageTitleContext,
    owner?: TitleContextOwner
  ): void {
    const current = this.contexts.get(menuId);
    if (
      current &&
      current.owner === owner &&
      contextsEqual(current.context, context)
    )
      return;
    this.contexts.set(menuId, { context, owner });
    this.notify();
  }

  clear(menuId: string, owner?: TitleContextOwner): void {
    const current = this.contexts.get(menuId);
    if (!current) return;
    if (owner && current.owner !== owner) return;
    this.contexts.delete(menuId);
    this.notify();
  }

  subscribe(listener: TitleContextListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const titleContextStore = new TitleContextStore();
