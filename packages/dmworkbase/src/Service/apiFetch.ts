import { buildAcceptLanguage } from "./apiLanguage";
import { normalizeApiError, NormalizedApiError } from "./apiError";

export class ApiFetchError extends Error implements NormalizedApiError {
  code?: string;
  httpStatus?: number;
  backendMessage?: string;
  details?: Record<string, unknown>;
  raw: unknown;

  constructor(
    normalized: NormalizedApiError,
    public readonly response: Response,
    public readonly data: unknown,
  ) {
    super(normalized.message);
    this.name = "ApiFetchError";
    this.code = normalized.code;
    this.httpStatus = normalized.httpStatus;
    this.backendMessage = normalized.backendMessage;
    this.details = normalized.details;
    this.raw = normalized.raw;
  }
}

export function isApiFetchError(error: unknown): error is ApiFetchError {
  return error instanceof ApiFetchError;
}

function buildHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", buildAcceptLanguage());
  }
  return headers;
}

async function readErrorData(response: Response): Promise<unknown> {
  const text = await response.clone().text().catch(() => "");
  if (!text) return { status: response.status };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { msg: text, status: response.status };
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: buildHeaders(input, init),
  });

  if (response.ok) return response;

  const data = await readErrorData(response);
  const normalized = normalizeApiError({
    data,
    httpStatus: response.status,
    raw: data,
  });
  throw new ApiFetchError(normalized, response, data);
}

export async function apiFetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
