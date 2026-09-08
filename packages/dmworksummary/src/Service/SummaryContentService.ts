import APIClient from "@octo/base/src/Service/APIClient";
import {
  decodeContentCatalog,
  decodeFormalVersion,
  decodeFormalVersionPage,
} from "../bridge/summaryWorkbench/formalContent";
import type {
  SummaryContentCatalog,
  SummaryFormalVersion,
  SummaryFormalVersionPage,
} from "./SummaryContentContract";
import { SummaryContentProtocolError } from "./SummaryContentContract";

export interface SummaryContentReadOptions {
  spaceId: string;
  signal?: AbortSignal;
}

export interface SummaryContentTransport {
  read(
    path: string,
    options: SummaryContentReadOptions,
    query?: Record<string, string | number>
  ): Promise<unknown>;
}

/** Preserve the host origin on Web, Electron and extension origins. */
export function resolveContentApiURL(path: string, apiURL: string, pageOrigin: string): string {
  const host = new URL(apiURL || "/", pageOrigin);
  if (host.protocol !== "http:" && host.protocol !== "https:") {
    throw new SummaryContentProtocolError("Summary API origin is unavailable");
  }
  return new URL(path, host.origin).toString();
}

const defaultTransport: SummaryContentTransport = {
  read(path, options, query) {
    return APIClient.shared.get<unknown>(
      resolveContentApiURL(path, APIClient.shared.config.apiURL, window.location.origin),
      { headers: { "X-Space-Id": options.spaceId }, signal: options.signal, param: query }
    );
  },
};

function summaryPath(summaryId: number, options: SummaryContentReadOptions): string {
  if (!Number.isSafeInteger(summaryId) || summaryId <= 0 || !options.spaceId.trim()) {
    throw new SummaryContentProtocolError("Summary identity and Space are required");
  }
  return `/summary/api/v1/summaries/${summaryId}/contents`;
}

function contentPath(summaryId: number, contentId: string, options: SummaryContentReadOptions): string {
  if (!/^sc1_[A-Za-z0-9_-]+$/.test(contentId)) {
    throw new SummaryContentProtocolError("Formal content identity is required");
  }
  return `${summaryPath(summaryId, options)}/${encodeURIComponent(contentId)}/versions`;
}

export class SummaryContentService {
  constructor(private readonly transport: SummaryContentTransport = defaultTransport) {}

  async loadContents(summaryId: number, options: SummaryContentReadOptions): Promise<SummaryContentCatalog> {
    const result = await this.transport.read(summaryPath(summaryId, options), options);
    return decodeContentCatalog(result, summaryId);
  }

  async loadVersions(
    summaryId: number,
    contentId: string,
    options: SummaryContentReadOptions,
    page: { cursor?: string; limit?: number } = {}
  ): Promise<SummaryFormalVersionPage> {
    const limit = page.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new SummaryContentProtocolError("Version page limit is invalid");
    }
    const result = await this.transport.read(contentPath(summaryId, contentId, options), options, {
      cursor: page.cursor ?? "",
      limit,
    });
    return decodeFormalVersionPage(result, contentId);
  }

  async loadVersion(
    summaryId: number,
    contentId: string,
    versionId: string,
    options: SummaryContentReadOptions
  ): Promise<SummaryFormalVersion> {
    if (!/^sv1_[A-Za-z0-9_-]+$/.test(versionId)) {
      throw new SummaryContentProtocolError("Formal version identity is required");
    }
    const result = await this.transport.read(
      `${contentPath(summaryId, contentId, options)}/${encodeURIComponent(versionId)}`, options
    );
    const version = decodeFormalVersion(result, contentId);
    if (version.version_id !== versionId) {
      throw new SummaryContentProtocolError("Version response does not match its request");
    }
    return version;
  }
}

export const summaryContentService = new SummaryContentService();
