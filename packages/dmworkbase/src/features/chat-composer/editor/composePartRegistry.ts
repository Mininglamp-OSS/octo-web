export interface EditorComposeNode {
  type?: string;
  attrs?: { id?: string; previewUrl?: string; [key: string]: unknown };
  content?: EditorComposeNode[];
  [key: string]: unknown;
}

export interface EditorComposeDocument extends EditorComposeNode {
  content?: EditorComposeNode[];
}

export interface EditorComposePart {
  id: string;
  kind: string;
  extensionId: string;
  node: EditorComposeNode;
  file?: File;
  previewUrl?: string;
}

export interface EditorComposePartContext {
  attachmentFiles: Map<string, File>;
  revokeObjectURL?: (url: string) => void;
}

export interface EditorComposePartExtension<
  TPart extends EditorComposePart = EditorComposePart,
> {
  id: string;
  priority?: number;
  canCapture: (node: EditorComposeNode) => boolean;
  capture: (
    node: EditorComposeNode,
    context: EditorComposePartContext,
  ) => TPart | undefined;
  restore?: (part: TPart) => EditorComposeNode | undefined;
  dispose?: (part: TPart, context: EditorComposePartContext) => void;
}

/** Tiptap-neutral registry for editor node capture, restore and resource cleanup. */
export class EditorComposePartRegistry {
  private readonly extensions = new Map<string, EditorComposePartExtension>();

  register<TPart extends EditorComposePart>(
    extension: EditorComposePartExtension<TPart>,
  ): () => boolean {
    if (this.extensions.has(extension.id)) {
      throw new Error(`editor compose part already registered: ${extension.id}`);
    }
    this.extensions.set(
      extension.id,
      extension as unknown as EditorComposePartExtension,
    );
    return () => this.unregister(extension.id);
  }

  unregister(id: string): boolean {
    return this.extensions.delete(id);
  }

  capture(
    document: EditorComposeDocument,
    context: EditorComposePartContext,
  ): EditorComposePart[] {
    const parts: EditorComposePart[] = [];
    const extensions = [...this.extensions.values()].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
    );
    const walk = (node: EditorComposeNode | undefined): void => {
      if (!node) return;
      const extension = extensions.find((candidate) =>
        candidate.canCapture(node),
      );
      if (extension) {
        const part = extension.capture(node, context);
        if (part) {
          parts.push(part);
          return;
        }
      }
      node.content?.forEach(walk);
    };
    document.content?.forEach(walk);
    return parts;
  }

  restore(part: EditorComposePart): EditorComposeNode | undefined {
    const extension = this.extensions.get(part.extensionId);
    return extension?.restore?.(part) ?? part.node;
  }

  dispose(part: EditorComposePart, context: EditorComposePartContext): void {
    this.extensions.get(part.extensionId)?.dispose?.(part, context);
  }

  clear(): void {
    this.extensions.clear();
  }
}

export const chatEditorComposePartRegistry = new EditorComposePartRegistry();

chatEditorComposePartRegistry.register({
  id: "attachment",
  canCapture: (node) => node.type === "attachment" && !!node.attrs?.id,
  capture: (node, context) => {
    const id = node.attrs?.id;
    if (!id) return undefined;
    return {
      id,
      kind: "attachment",
      extensionId: "attachment",
      node,
      file: context.attachmentFiles.get(id),
      previewUrl: node.attrs?.previewUrl,
    };
  },
  restore: (part) => part.node,
  dispose: (part, context) => {
    context.attachmentFiles.delete(part.id);
    if (part.previewUrl) context.revokeObjectURL?.(part.previewUrl);
  },
});
