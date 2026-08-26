/** Editor-neutral document shape shared by capture, recovery and ports. */
export interface EditorComposeNode {
  type?: string;
  attrs?: { id?: string; previewUrl?: string; [key: string]: unknown };
  content?: EditorComposeNode[];
  [key: string]: unknown;
}

export interface EditorComposeDocument extends EditorComposeNode {
  content?: EditorComposeNode[];
}
