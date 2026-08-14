import type {
  EditorComposeDocument,
  EditorComposeNode,
  EditorContentBlock,
} from "../domain";
import { isEditorContentBlock } from "../domain";

export type { EditorComposeDocument, EditorComposeNode } from "../domain";

export interface EditorComposePart {
  id: string;
  kind: string;
  extensionId: string;
  placement?: "inline" | "block";
  node: EditorComposeNode;
  file?: File;
  previewUrl?: string;
}

export interface EditorComposePartContext {
  attachmentFiles: Map<string, File>;
  revokeObjectURL?: (url: string) => void;
  disposeAttachment?: (id: string, previewUrl?: string) => void;
}

export type EditorComposePartSendBlock = Exclude<
  EditorContentBlock,
  { type: "text" }
>;

export class UnsupportedEditorComposePartError extends Error {
  constructor(extensionId: string) {
    super(`editor compose part cannot participate in send settlement: ${extensionId}`);
    this.name = "UnsupportedEditorComposePartError";
  }
}

export class MissingEditorComposePartExtensionError extends Error {
  constructor(extensionId: string) {
    super(`editor compose part extension is not registered: ${extensionId}`);
    this.name = "MissingEditorComposePartExtensionError";
  }
}

export class InvalidEditorComposePartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEditorComposePartError";
  }
}

export interface EditorComposePartExtension<
  TPart extends EditorComposePart = EditorComposePart,
> {
  id: string;
  priority?: number;
  /** Cross-instance recovery model. Custom extensions currently support snapshot only. */
  recovery?: "snapshot" | "attachment";
  canCapture: (node: EditorComposeNode) => boolean;
  capture: (
    node: EditorComposeNode,
    context: EditorComposePartContext,
  ) => TPart | undefined;
  restore?: (part: TPart) => EditorComposeNode | undefined;
  dispose?: (part: TPart, context: EditorComposePartContext) => void;
  /** Map an atomic editor node to a built-in or extension send block. */
  toSendBlock?: (part: TPart) => EditorComposePartSendBlock | undefined;
}

/** Tiptap-neutral registry for editor node capture, restore and resource cleanup. */
export class EditorComposePartRegistry {
  private readonly extensions = new Map<string, EditorComposePartExtension>();
  private readonly capturedOwners = new WeakMap<
    EditorComposePart,
    EditorComposePartExtension
  >();
  private readonly capturedSources = new WeakMap<
    EditorComposePart,
    EditorComposeNode
  >();
  private orderedExtensionsCache?: EditorComposePartExtension[];

  register<TPart extends EditorComposePart>(
    extension: EditorComposePartExtension<TPart>,
  ): () => boolean {
    if (this.extensions.has(extension.id)) {
      throw new Error(`editor compose part already registered: ${extension.id}`);
    }
    const registered = extension as unknown as EditorComposePartExtension;
    this.extensions.set(
      extension.id,
      registered,
    );
    this.orderedExtensionsCache = undefined;
    return () => {
      if (this.extensions.get(extension.id) !== registered) return false;
      this.extensions.delete(extension.id);
      this.orderedExtensionsCache = undefined;
      return true;
    };
  }

  unregister(id: string): boolean {
    const deleted = this.extensions.delete(id);
    if (deleted) this.orderedExtensionsCache = undefined;
    return deleted;
  }

  capture(
    document: EditorComposeDocument,
    context: EditorComposePartContext,
  ): EditorComposePart[] {
    const parts: EditorComposePart[] = [];
    const ids = new Set<string>();
    const walk = (node: EditorComposeNode | undefined): void => {
      if (!node) return;
      const part = this.captureNode(node, context);
      if (part) {
        if (ids.has(part.id)) {
          throw new Error(`duplicate editor compose part id: ${part.id}`);
        }
        ids.add(part.id);
        parts.push(part);
        return;
      }
      node.content?.forEach(walk);
    };
    document.content?.forEach(walk);
    return parts;
  }

  captureNode(
    node: EditorComposeNode,
    context: EditorComposePartContext,
  ): EditorComposePart | undefined {
    const extension = this.orderedExtensions().find((candidate) =>
      candidate.canCapture(node),
    );
    const part = extension?.capture(node, context);
    if (part && extension) {
      if (part.id.trim() === "") {
        throw new InvalidEditorComposePartError(
          `editor compose part id is empty: ${extension.id}`,
        );
      }
      if (part.extensionId !== extension.id) {
        throw new InvalidEditorComposePartError(
          `editor compose part owner mismatch: ${part.extensionId} !== ${extension.id}`,
        );
      }
      if (extension.recovery === "snapshot") {
        const snapshotId = node.attrs?.id;
        if (
          typeof snapshotId !== "string" ||
          snapshotId.trim() === "" ||
          snapshotId !== part.id
        ) {
          throw new InvalidEditorComposePartError(
            `snapshot editor compose part id must match node attrs.id: ${part.id}`,
          );
        }
      }
      this.capturedOwners.set(part, extension);
      this.capturedSources.set(part, node);
    }
    return part;
  }

  sourceNode(part: EditorComposePart): EditorComposeNode {
    return this.capturedSources.get(part) ?? part.node;
  }

  assertSettlementSupported(part: EditorComposePart): void {
    const extension = this.extensionFor(part);
    if (!extension.toSendBlock) {
      throw new UnsupportedEditorComposePartError(part.extensionId);
    }
    if (
      extension.recovery !== "snapshot" &&
      !(extension.id === "attachment" && extension.recovery === "attachment")
    ) {
      throw new UnsupportedEditorComposePartError(part.extensionId);
    }
  }

  toSendBlock(part: EditorComposePart): EditorComposePartSendBlock {
    const extension = this.extensionFor(part);
    const block = extension.toSendBlock?.(part);
    if (!block) throw new UnsupportedEditorComposePartError(part.extensionId);
    if (
      !isEditorContentBlock(block) ||
      (block as { type: string }).type === "text"
    ) {
      throw new InvalidEditorComposePartError(
        `editor compose part returned an invalid send block: ${part.id}`,
      );
    }
    if (block.id !== part.id) {
      throw new InvalidEditorComposePartError(
        `editor compose part send block id mismatch: ${block.id} !== ${part.id}`,
      );
    }
    return block;
  }

  restore(part: EditorComposePart): EditorComposeNode | undefined {
    const extension = this.extensionFor(part);
    return extension?.restore?.(part) ?? part.node;
  }

  dispose(part: EditorComposePart, context: EditorComposePartContext): void {
    this.extensionFor(part).dispose?.(part, context);
  }

  clear(): void {
    this.extensions.clear();
    this.orderedExtensionsCache = undefined;
  }

  private extensionFor(part: EditorComposePart): EditorComposePartExtension {
    const extension =
      this.capturedOwners.get(part) ?? this.extensions.get(part.extensionId);
    if (!extension) {
      throw new MissingEditorComposePartExtensionError(part.extensionId);
    }
    return extension;
  }

  private orderedExtensions(): EditorComposePartExtension[] {
    if (!this.orderedExtensionsCache) {
      this.orderedExtensionsCache = [...this.extensions.values()].sort(
        (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
      );
    }
    return this.orderedExtensionsCache;
  }
}

export function registerDefaultEditorComposeParts(
  registry: EditorComposePartRegistry,
): void {
  registry.register({
    id: "attachment",
    recovery: "attachment",
    canCapture: (node) => node.type === "attachment" && !!node.attrs?.id,
    capture: (node, context) => {
      const id = node.attrs?.id;
      if (!id) return undefined;
      return {
        id,
        kind: "attachment",
        extensionId: "attachment",
        placement: "inline",
        node,
        file: context.attachmentFiles.get(id),
        previewUrl: node.attrs?.previewUrl,
      };
    },
    restore: (part) => part.node,
    toSendBlock: (part) => {
      if (!part.file) return undefined;
      return {
        type: part.file.type.startsWith("image/") ? "image" : "file",
        id: part.id,
        file: part.file,
      };
    },
    dispose: (part, context) => {
      if (context.disposeAttachment) {
        context.disposeAttachment(part.id, part.previewUrl);
        return;
      }
      context.attachmentFiles.delete(part.id);
      if (part.previewUrl) context.revokeObjectURL?.(part.previewUrl);
    },
  });
}

export function createDefaultEditorComposePartRegistry(): EditorComposePartRegistry {
  const registry = new EditorComposePartRegistry();
  registerDefaultEditorComposeParts(registry);
  return registry;
}
