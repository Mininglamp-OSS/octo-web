import { afterEach, beforeEach, describe, expect, it } from "vitest";
import axios, { type AxiosRequestConfig } from "axios";
import APIClient from "../APIClient";
import SearchService from "../SearchService";
import type { GlobalSearchQuery } from "../SearchTypes";

const client = APIClient.shared;
const originalAdapter = axios.defaults.adapter;
const originalApiURL = client.config.apiURL;
const originalBaseURL = axios.defaults.baseURL;
const originalTokenCallback = client.config.tokenCallback;
const originalSpaceIdCallback = client.config.spaceIdCallback;
let requests: AxiosRequestConfig[];
let responseData: unknown;

function bodyOf(request: AxiosRequestConfig): Record<string, unknown> {
  return typeof request.data === "string"
    ? JSON.parse(request.data)
    : (request.data as Record<string, unknown>);
}

function combinedUrl(request: AxiosRequestConfig): string {
  return `${request.baseURL ?? ""}${request.url ?? ""}`;
}

beforeEach(() => {
  requests = [];
  responseData = { total: 0, items: [] };
  client.config.apiURL = "/api/v1/";
  client.config.tokenCallback = () => "test-token";
  client.config.spaceIdCallback = () => "current-space";
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    return {
      data: responseData,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  client.config.tokenCallback = originalTokenCallback;
  client.config.spaceIdCallback = originalSpaceIdCallback;
  client.config.apiURL = originalApiURL;
  axios.defaults.baseURL = originalBaseURL;
});

describe("SearchService.searchDocs HTTP boundary", () => {
  it("keeps the relative Web path/baseURL, injects auth and space headers, and omits uid/space from the body", async () => {
    const result = await SearchService.searchDocs({
      keyword: "spec",
      pageSize: 20,
    });

    expect(result).toEqual({ total: 0, items: [], nextCursor: undefined });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("docs/search");
    expect(requests[0].baseURL).toBe("/api/v1/");
    expect(combinedUrl(requests[0])).toBe("/api/v1/docs/search");
    expect(bodyOf(requests[0])).toEqual({ q: "spec", pageSize: 20 });
    expect(bodyOf(requests[0])).not.toHaveProperty("uid");
    expect(bodyOf(requests[0])).not.toHaveProperty("spaceId");
    expect(requests[0].headers).toMatchObject({
      token: "test-token",
      "X-Space-Id": "current-space",
    });
  });

  it.each(["/api/v1/", "https://api.example.com/v1/"])(
    "preserves q/pageSize and forwards the keyset cursor with base %s",
    async (apiURL) => {
      client.config.apiURL = apiURL;
      await SearchService.searchDocs({ keyword: "first", pageSize: 20 });
      expect(bodyOf(requests[0])).toEqual({ q: "first", pageSize: 20 });

      await SearchService.searchDocs({
        keyword: "next",
        pageSize: 50,
        cursor: "cur-2",
      });
      expect(bodyOf(requests[1])).toEqual({
        q: "next",
        pageSize: 50,
        cursor: "cur-2",
      });
    }
  );

  it("routes docs search to /api/v1/docs/search on the desktop /v1/ base", async () => {
    client.config.apiURL = "https://api.example.com/v1/";

    await SearchService.searchDocs({ keyword: "spec", pageSize: 20 });

    expect(requests[0].url).toBe("https://api.example.com/api/v1/docs/search");
    expect(requests[0].baseURL).toBe("https://api.example.com/v1/");
    expect(requests[0].headers).toMatchObject({
      token: "test-token",
      "X-Space-Id": "current-space",
    });
    expect(bodyOf(requests[0])).toEqual({ q: "spec", pageSize: 20 });
  });

  it("handles an http localhost origin with a non-default port", async () => {
    client.config.apiURL = "http://localhost:8080/v1/";

    await SearchService.searchDocs({ keyword: "spec", pageSize: 20 });

    expect(requests[0].url).toBe("http://localhost:8080/api/v1/docs/search");
  });

  it("does not double the /api/v1/ prefix when the absolute base already carries it", async () => {
    client.config.apiURL = "https://api.example.com/api/v1/";

    await SearchService.searchDocs({ keyword: "spec", pageSize: 20 });

    expect(requests[0].url).toBe("https://api.example.com/api/v1/docs/search");
  });

  it("leaves global apiURL/defaults untouched and keeps a later IM search under /v1/", async () => {
    const apiURL = "https://api.example.com/v1/";
    client.config.apiURL = apiURL;

    await SearchService.searchDocs({ keyword: "spec", pageSize: 20 });
    expect(client.config.apiURL).toBe(apiURL);
    expect(axios.defaults.baseURL).toBe(apiURL);
    expect(requests[0].url).toBe("https://api.example.com/api/v1/docs/search");

    responseData = { items: [], pagination: { has_more: false } };
    const globalQuery: GlobalSearchQuery = {
      tab: "messages",
      keyword: "x",
      filters: {
        senderUids: [],
        memberUids: [],
        channels: [],
        channelTypes: [],
        contentTypes: [],
        fileExts: [],
        sort: "relevance",
      },
      limit: 20,
    };
    await SearchService.searchGlobalMessages(globalQuery);

    expect(requests[1].url).toBe("messages/_search_global_messages");
    expect(combinedUrl(requests[1])).toBe(
      "https://api.example.com/v1/messages/_search_global_messages"
    );
  });

  it("re-reads the API origin at call time instead of caching it", async () => {
    client.config.apiURL = "https://api.one.example/v1/";
    await SearchService.searchDocs({ keyword: "a", pageSize: 20 });
    expect(requests[0].url).toBe("https://api.one.example/api/v1/docs/search");

    client.config.apiURL = "https://api.two.example:8443/v1/";
    await SearchService.searchDocs({ keyword: "b", pageSize: 20 });
    expect(requests[1].url).toBe(
      "https://api.two.example:8443/api/v1/docs/search"
    );
  });
});
