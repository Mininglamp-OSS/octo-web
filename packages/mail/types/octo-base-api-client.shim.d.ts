declare module "@octo/base/src/Service/APIClient" {
  interface RequestConfig {
    param?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    responseType?: "blob";
    timeout?: number;
    signal?: AbortSignal;
    data?: unknown;
    suppressAuthExpiredLogout?: boolean;
  }

  export function extractErrorMsg(error: unknown): string;

  export default class APIClient {
    static shared: APIClient;
    config: { apiURL: string };
    get<T>(path: string, config?: RequestConfig): Promise<T>;
    post(path: string, data?: unknown, config?: RequestConfig): Promise<any>;
    patch(path: string, data?: unknown, config?: RequestConfig): Promise<any>;
    delete(path: string, config?: RequestConfig): Promise<any>;
  }
}
