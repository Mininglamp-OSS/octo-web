import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { type AxiosRequestConfig } from "axios";
import APIClient from "../APIClient";
import {
  DocumentPreviewError,
  getDocumentPreviewBody,
  installDocumentPreviewTransport,
} from "../DocumentPreviewService";

const client = APIClient.shared;
const originalAdapter = axios.defaults.adapter;
const originalApiURL = client.config.apiURL;
let requests: AxiosRequestConfig[];
let dispose: (() => void) | undefined;

beforeEach(() => {
  requests = [];
  client.config.apiURL = "/api/v1/";
  client.config.tokenCallback = () => "test-token";
  client.config.spaceIdCallback = () => "current-space";
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { doc: {} }, status: 200, statusText: "OK", headers: {}, config };
  };
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  axios.defaults.adapter = originalAdapter;
  client.config.apiURL = originalApiURL;
  client.config.tokenCallback = undefined;
  client.config.spaceIdCallback = undefined;
});

describe("document preview HTTP boundary", () => {
  it.each([
    ["doc", "content"],
    ["board", "scene"],
    ["sheet", "sheet"],
    ["html", "html-preview"],
  ] as const)("preserves Web proxy, authentication and explicit space for %s", async (kind, endpoint) => {
    await expect(getDocumentPreviewBody({ kind, docId: "d_1" }, "doc-space"))
      .resolves.toEqual({ doc: {} });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `docs/d_1/${endpoint}`,
      baseURL: "/api/v1/",
      params: { sp: "doc-space" },
      headers: { token: "test-token", "X-Space-Id": "doc-space" },
    });
  });

  it.each(["https://api.test/v1/", "https://api.test/api/v1/"])(
    "uses the Docs namespace with absolute API base %s", async (apiURL) => {
      client.config.apiURL = apiURL;
      await getDocumentPreviewBody({ kind: "html", docId: "d_1" }, "");
      expect(requests[0].url).toBe("https://api.test/api/v1/docs/d_1/html-preview");
      expect(client.config.apiURL).toBe(apiURL);
    },
  );

  it("encodes document identity as a single path segment", async () => {
    await getDocumentPreviewBody({ kind: "doc", docId: "a/b?#" }, "");
    expect(requests[0].url).toBe("docs/a%2Fb%3F%23/content");
  });

  it("uses host transport without forwarding renderer space or credentials", async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, body: { preview: {} } });
    dispose = installDocumentPreviewTransport(transport);
    await expect(getDocumentPreviewBody({ kind: "html", docId: "d_1" }, "wire-space"))
      .resolves.toEqual({ preview: {} });
    expect(transport).toHaveBeenCalledWith({ kind: "html", docId: "d_1" });
    expect(requests).toHaveLength(0);
  });

  it("preserves host error status and wire code without retrying browser HTTP", async () => {
    dispose = installDocumentPreviewTransport(async () => ({
      ok: false, status: 409, code: "conflict",
    }));
    await expect(getDocumentPreviewBody({ kind: "doc", docId: "d_1" }, ""))
      .rejects.toEqual(new DocumentPreviewError(409, "conflict"));
    expect(requests).toHaveLength(0);
  });

  it("does not retry a rejected host operation through browser HTTP", async () => {
    dispose = installDocumentPreviewTransport(async () => { throw new Error("offline"); });
    await expect(getDocumentPreviewBody({ kind: "doc", docId: "d_1" }, ""))
      .rejects.toThrow("offline");
    expect(requests).toHaveLength(0);
  });

  it("restores Web HTTP after disposal without removing a newer transport", async () => {
    const first = installDocumentPreviewTransport(async () => ({ ok: true, body: "old" }));
    dispose = installDocumentPreviewTransport(async () => ({ ok: true, body: "new" }));
    first();
    await expect(getDocumentPreviewBody({ kind: "doc", docId: "d_1" }, ""))
      .resolves.toBe("new");
    dispose();
    await getDocumentPreviewBody({ kind: "doc", docId: "d_1" }, "");
    expect(requests).toHaveLength(1);
  });
});
