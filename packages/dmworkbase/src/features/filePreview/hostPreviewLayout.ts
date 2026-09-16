import type { AttachmentPreviewHost, AttachmentPreviewRequest } from "@octo/file-preview";

export interface HostFilePreviewLayout {
  version: 1;
  requestId: string;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

/** Optional layout capability; older hosts keep their existing preview surface. */
export interface LayoutAttachmentHost extends AttachmentPreviewHost {
  openFilePreviewInPlace?(request: AttachmentPreviewRequest): ReturnType<AttachmentPreviewHost["openFilePreview"]>;
  setFilePreviewLayout?(layout: HostFilePreviewLayout): Promise<void>;
}
