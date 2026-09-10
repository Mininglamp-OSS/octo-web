import APIClient from "@octo/base/src/Service/APIClient";
import {
  decodeContentCatalog,
  decodeContentGeneration,
  decodeFormalVersion,
  decodeFormalVersionPage,
  decodeGenerationConfiguration,
} from "../bridge/summaryWorkbench/formalContent";
import type {
  SummaryContentCatalog,
  SummaryContentBaseline,
  SummaryContentGeneration,
  SummaryContentRefineRequest,
  SummaryFormalVersion,
  SummaryFormalVersionPage,
  SummaryGenerationConfiguration,
  SummaryRegenerateRequest,
  SummarySaveConfigurationRequest,
  SummarySavedConfiguration,
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
  // Optional so read-only hosts remain usable during the compatibility rollout.
  command?(
    path: string,
    options: SummaryContentReadOptions,
    data: Record<string, unknown>
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
  command(path, options, data) {
    return APIClient.shared.post(
      resolveContentApiURL(path, APIClient.shared.config.apiURL, window.location.origin), data,
      { headers: { "X-Space-Id": options.spaceId }, signal: options.signal }
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
  return `${summaryPath(summaryId, options)}/${encodeURIComponent(contentId)}`;
}

function checkedBaseline(baseline: SummaryContentBaseline): Record<string, unknown> {
  if (!/^sv1_[A-Za-z0-9_-]+$/.test(baseline.expected_current_version_id) ||
      !Number.isSafeInteger(baseline.expected_content_revision) || baseline.expected_content_revision < 1) {
    throw new SummaryContentProtocolError("A current formal version and revision are required");
  }
  return {
    expected_current_version_id: baseline.expected_current_version_id,
    expected_content_revision: baseline.expected_content_revision,
  };
}

function generationPath(summaryId: number, contentId: string, generationId: string, options: SummaryContentReadOptions): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(generationId)) {
    throw new SummaryContentProtocolError("A durable generation identity is required");
  }
  return `${contentPath(summaryId, contentId, options)}/generations/${generationId}`;
}

function decodeChangedCurrent(value: unknown, baseline: SummaryContentBaseline): SummaryFormalVersion {
  const version = decodeFormalVersion(value, baseline.content_id);
  if (!version.is_current || version.pending_application ||
      version.content_revision !== baseline.expected_content_revision + 1) {
    throw new SummaryContentProtocolError("Command did not return the next current revision");
  }
  return version;
}

export class SummaryContentService {
  constructor(private readonly transport: SummaryContentTransport = defaultTransport) {}

  async loadContents(summaryId: number, options: SummaryContentReadOptions): Promise<SummaryContentCatalog> {
    const result = await this.transport.read(summaryPath(summaryId, options), options);
    const catalog = decodeContentCatalog(result, summaryId);
    if (catalog.contents.some((content) => content.active_generation && content.active_generation.space_id !== options.spaceId)) {
      throw new SummaryContentProtocolError("Generation response does not match its Space");
    }
    return catalog;
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
    const result = await this.transport.read(`${contentPath(summaryId, contentId, options)}/versions`, options, {
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
      `${contentPath(summaryId, contentId, options)}/versions/${encodeURIComponent(versionId)}`, options
    );
    const version = decodeFormalVersion(result, contentId);
    if (version.version_id !== versionId) {
      throw new SummaryContentProtocolError("Version response does not match its request");
    }
    return version;
  }

  private command(path: string, options: SummaryContentReadOptions, data: Record<string, unknown>): Promise<unknown> {
    if (!this.transport.command) {
      throw new SummaryContentProtocolError("Formal content writes are unavailable");
    }
    return this.transport.command(path, options, data);
  }

  async editCurrent(summaryId: number, baseline: SummaryContentBaseline, content: string, options: SummaryContentReadOptions): Promise<SummaryFormalVersion> {
    if (!content.trim() || new TextEncoder().encode(content).length > 500 * 1024) {
      throw new SummaryContentProtocolError("Content is empty or too large");
    }
    const result = await this.command(`${contentPath(summaryId, baseline.content_id, options)}/edit`, options, {
      ...checkedBaseline(baseline), content,
    });
    return decodeChangedCurrent(result, baseline);
  }

  async restoreCurrent(summaryId: number, baseline: SummaryContentBaseline, sourceVersionId: string, options: SummaryContentReadOptions): Promise<SummaryFormalVersion> {
    if (!/^sv1_[A-Za-z0-9_-]+$/.test(sourceVersionId) || sourceVersionId === baseline.expected_current_version_id) {
      throw new SummaryContentProtocolError("A different formal source version is required");
    }
    const result = await this.command(`${contentPath(summaryId, baseline.content_id, options)}/restore`, options, {
      ...checkedBaseline(baseline), source_version_id: sourceVersionId,
    });
    return decodeChangedCurrent(result, baseline);
  }

  async refineCurrent(summaryId: number, request: SummaryContentRefineRequest, options: SummaryContentReadOptions): Promise<SummaryContentGeneration> {
    if (!request.feedback.trim() || Array.from(request.feedback).length > 2000 ||
        !request.idempotency_key.trim() || new TextEncoder().encode(request.idempotency_key).length > 128) {
      throw new SummaryContentProtocolError("Feedback and a stable idempotency key are required");
    }
    const result = await this.command(`${contentPath(summaryId, request.content_id, options)}/generations/refine`, options, {
      ...checkedBaseline(request), feedback: request.feedback, idempotency_key: request.idempotency_key,
    });
    return decodeContentGeneration(result, { summaryId, contentId: request.content_id, spaceId: options.spaceId });
  }

  async loadGeneration(summaryId: number, contentId: string, generationId: string, options: SummaryContentReadOptions): Promise<SummaryContentGeneration> {
    const result = await this.transport.read(generationPath(summaryId, contentId, generationId, options), options);
    return decodeContentGeneration(result, { summaryId, contentId, generationId, spaceId: options.spaceId });
  }

  async cancelGeneration(summaryId: number, contentId: string, generationId: string, options: SummaryContentReadOptions): Promise<SummaryContentGeneration> {
    const result = await this.command(`${generationPath(summaryId, contentId, generationId, options)}/cancel`, options, {});
    return decodeContentGeneration(result, { summaryId, contentId, generationId, spaceId: options.spaceId });
  }

  async applyCandidate(summaryId: number, baseline: SummaryContentBaseline, generationId: string, options: SummaryContentReadOptions): Promise<SummaryFormalVersion> {
    const result = await this.command(`${generationPath(summaryId, baseline.content_id, generationId, options)}/apply`, options, checkedBaseline(baseline));
    return decodeChangedCurrent(result, baseline);
  }

  async loadConfiguration(summaryId: number, contentId: string, options: SummaryContentReadOptions): Promise<SummaryGenerationConfiguration> {
    return decodeGenerationConfiguration(await this.transport.read(`${contentPath(summaryId, contentId, options)}/configuration`, options));
  }

  async regenerateCurrent(summaryId: number, request: SummaryRegenerateRequest, options: SummaryContentReadOptions): Promise<SummaryContentGeneration> {
    const result = await this.command(`${contentPath(summaryId, request.content_id, options)}/generations/regenerate`, options, {
      ...checkedRegeneration(request),
    });
    return decodeContentGeneration(result, { summaryId, contentId: request.content_id, spaceId: options.spaceId });
  }

  async saveConfiguration(summaryId: number, contentId: string, request: SummarySaveConfigurationRequest, options: SummaryContentReadOptions): Promise<SummarySavedConfiguration> {
    checkedConfigRevision(request.expected_config_revision);
    if (request.generate && request.generate.content_id !== contentId) {
      throw new SummaryContentProtocolError("Configuration generation target does not match");
    }
    const result = await this.command(`${contentPath(summaryId, contentId, options)}/configuration`, options, {
      expected_config_revision: request.expected_config_revision, spec: request.spec,
      ...(request.schedule ? { schedule: request.schedule } : {}),
      ...(request.generate ? { generate: checkedRegeneration(request.generate) } : {}),
    });
    if (!result || typeof result !== "object") throw new SummaryContentProtocolError("Configuration response is invalid");
    const envelope = Object.fromEntries(Object.entries(result));
    const payload: unknown = "code" in envelope ? (envelope.code === 0 ? envelope.data : null) : envelope;
    if (!payload || typeof payload !== "object") throw new SummaryContentProtocolError("Configuration response is invalid");
    const data = Object.fromEntries(Object.entries(payload));
    return {
      configuration: decodeGenerationConfiguration(data.configuration),
      generation: data.generation == null ? null : decodeContentGeneration(data.generation, { summaryId, contentId, spaceId: options.spaceId }),
    };
  }
}

function checkedConfigRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new SummaryContentProtocolError("Configuration revision is required");
}

function checkedRegeneration(request: SummaryRegenerateRequest): Record<string, unknown> {
  checkedConfigRevision(request.expected_config_revision);
  if (!request.idempotency_key.trim() || new TextEncoder().encode(request.idempotency_key).length > 128) {
    throw new SummaryContentProtocolError("A stable idempotency key is required");
  }
  const override = request.requirement_override?.trim();
  return {
    ...checkedBaseline(request), expected_config_revision: request.expected_config_revision, idempotency_key: request.idempotency_key,
    ...(override ? { requirement_override: override } : {}),
  };
}

export const summaryContentService = new SummaryContentService();
