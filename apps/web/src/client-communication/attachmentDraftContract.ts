// Wire contract for Client-owned drafts. Keep aligned with Client shared/local-attachment-drafts.ts.
export type LocalAttachmentDraftSource = 'upload' | 'paste'
export interface LocalAttachmentDraftChannel { id: string; type: number }
export interface LocalAttachmentDraftMetadata {
  id: string
  revision: string
  position: number
  name: string
  mimeType: string
  size: number
  lastModified: number
  source: LocalAttachmentDraftSource
  createdAt: number
  updatedAt: number
}
export type DraftAttachmentInput = Omit<LocalAttachmentDraftMetadata, 'revision' | 'createdAt' | 'updatedAt'>
export interface DraftReference { id: string; revision: string }
export interface DraftOpenInput { spaceId: string; channel: LocalAttachmentDraftChannel }
export interface DraftStageInput { leaseId: string; attachment: DraftAttachmentInput; bytes: ArrayBuffer | Uint8Array }
export interface DraftSelection { leaseId: string; attachments: DraftReference[] }
export interface DraftSendSelection { leaseId: string; requestId: string; attachments: Array<{ id: string; revision?: string }> }
export interface DraftSettlement { sendId: string; keepAttachmentIds: string[] }
export interface DraftOpenResult {
  leaseId: string
  attachments: Array<{ attachment: LocalAttachmentDraftMetadata; bytes: Uint8Array }>
  failedCount: number
}
/** Desktop-owned lifecycle. Renderer receipts are opaque, never filesystem paths. */
export interface LocalAttachmentDraftBridge {
  version: 4
  open(input: DraftOpenInput): Promise<DraftOpenResult>
  stage(input: DraftStageInput): Promise<LocalAttachmentDraftMetadata>
  remove(input: DraftSelection): Promise<void>
  prepareSend(input: DraftSendSelection): Promise<{ sendId: string }>
  settleSend(input: DraftSettlement): Promise<void>
}
