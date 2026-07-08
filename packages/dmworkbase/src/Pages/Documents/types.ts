export type DocumentStatus = "conversation" | "archived" | "deleted";
export type DocumentVisibility = "conversation" | "space" | "specified";
export type DocumentKind = "pdf" | "doc" | "sheet" | "image" | "zip";
export type DocumentTab = "recent" | "conversation" | "space" | "sent" | "trash";
export type DocumentSourceType = "direct" | "group" | "app";

export interface DocumentViewer {
  uid: string;
  name: string;
  accessibleChannelIds: string[];
  accessibleSpaceNames: string[];
}

export interface DocumentAccess {
  userUids?: string[];
  channelIds?: string[];
  spaceNames?: string[];
}

export interface DocumentAsset {
  id: string;
  name: string;
  kind: DocumentKind;
  extension: string;
  size: number;
  url: string;
  owner: string;
  uploader: string;
  uploaderUid: string;
  sourceName: string;
  sourceChannelId: string;
  sourceChannelType: number;
  sourceType: DocumentSourceType;
  sourceMessageId: string;
  sourceMessageSeq: number;
  sourceSenderUid: string;
  sourceSenderName: string;
  sourceSentAt: string;
  sourcePreviewText?: string;
  spaceName: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  createdAt: string;
  lastAccessAt: string;
  downloads: number;
  previewable: boolean;
  flow: string[];
  access: DocumentAccess;
}

export interface DocumentSpace {
  id: string;
  name: string;
  fileCount: number;
  memberCount: number;
  description: string;
}

export interface DocumentState {
  files: DocumentAsset[];
  spaces: DocumentSpace[];
}

export interface DocumentSummary {
  activeFiles: number;
  spaceFiles: number;
  conversationFiles: number;
}

export interface ArchiveMessageFileInput {
  id: string;
  name: string;
  extension: string;
  size: number;
  url: string;
  sourceName: string;
  sourceChannelId: string;
  sourceChannelType: number;
  sourceType: DocumentSourceType;
  sourceMessageId: string;
  sourceMessageSeq: number;
  sourceSenderUid: string;
  sourceSenderName: string;
  sourceSentAt: string;
  sourcePreviewText?: string;
  uploader: string;
  uploaderUid: string;
  createdAt?: string;
  previewable?: boolean;
}
