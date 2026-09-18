import { EventEmitter } from "node:events";
import type { BrowserContext } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { monitorMockNetwork } from "../../e2e-kit/mock-network-monitor";

function makeRequest(path: string, workerOwned = false, error = "net::ERR_CONNECTION_REFUSED") {
  return {
    url: () => new URL(path, "http://localhost:5173").href,
    method: () => "GET",
    serviceWorker: () => workerOwned ? {} : null,
    failure: () => ({ errorText: error }),
    frame: () => { throw new Error("Worker requests have no frame"); },
  };
}

function setup() {
  const context = new EventEmitter();
  const monitor = monitorMockNetwork(context as unknown as BrowserContext);
  const respond = (path: string, status: number) => {
    const request = makeRequest(path);
    context.emit("response", { url: request.url, status: () => status, request: () => request });
  };
  return { context, monitor, respond };
}

describe("mock network guard", () => {
  it("accepts mocked API success and the intentional boot device 400", () => {
    const { context, monitor, respond } = setup();
    context.emit("request", makeRequest("/api/v1/spaces/e2e-space-001/categories"));
    respond("/api/v1/spaces/e2e-space-001/categories", 200);
    respond("/api/v1/user/devices/e2e-device", 400);
    expect(monitor.issues).toEqual([]);
  });

  it("catches worker-owned passthrough before any response, without accessing a frame", () => {
    const { context, monitor } = setup();
    context.emit("request", makeRequest("/api/v1/spaces/e2e-space-001/categories", true));
    expect(monitor.issues).toEqual([
      "Service Worker API passthrough: GET http://localhost:5173/api/v1/spaces/e2e-space-001/categories",
    ]);
  });

  it("catches categories 502 outside the summary API prefix", () => {
    const { monitor, respond } = setup();
    respond("/api/v1/spaces/e2e-space-001/categories", 502);
    expect(monitor.issues).toEqual([
      "API 502: GET http://localhost:5173/api/v1/spaces/e2e-space-001/categories",
    ]);
  });

  it("retains summary 4xx and generic API 401 checks", () => {
    const { monitor, respond } = setup();
    respond("/summary/api/v1/summaries/30168", 403);
    respond("/api/v1/user", 401);
    expect(monitor.issues).toHaveLength(2);
    expect(monitor.issues[0]).toContain("API 403:");
    expect(monitor.issues[1]).toContain("API 401:");
  });

  it("records network failures but not normal page navigation cancellation", () => {
    const { context, monitor } = setup();
    context.emit("requestfailed", makeRequest("/api/v1/spaces/x/categories"));
    context.emit("requestfailed", makeRequest("/api/v1/spaces/y/categories", false, "net::ERR_ABORTED"));
    expect(monitor.issues).toHaveLength(1);
    expect(monitor.issues[0]).toContain("net::ERR_CONNECTION_REFUSED");
  });

  it("does not excuse an aborted worker-owned outgoing request", () => {
    const { context, monitor } = setup();
    const request = makeRequest("/summary/api/v1/summaries", true, "net::ERR_ABORTED");
    context.emit("request", request);
    context.emit("requestfailed", request);
    expect(monitor.issues).toHaveLength(1);
    expect(monitor.issues[0]).toContain("Service Worker API passthrough:");
  });

  it("detects configured backend hosts, not matching strings in URL queries", () => {
    const { context, monitor } = setup();
    context.emit("request", makeRequest("http://127.0.0.1:9/api/v1/user"));
    context.emit("request", makeRequest("http://mock.e2e.local/api/v1/user"));
    context.emit("request", makeRequest("/api/v1/search?q=mock.e2e.local"));
    expect(monitor.issues).toHaveLength(2);
    expect(monitor.issues.every(issue => issue.startsWith("Real backend request:"))).toBe(true);
  });

  it("ignores static asset and probe requests owned by the worker", () => {
    const { context, monitor, respond } = setup();
    context.emit("request", makeRequest("/assets/logo.svg", true));
    context.emit("request", makeRequest("/__msw_probe__", true));
    respond("/assets/logo.svg", 404);
    expect(monitor.issues).toEqual([]);
  });

  it("removes only its own listeners on stop", () => {
    const { context, monitor, respond } = setup();
    const unrelated = () => {};
    context.on("response", unrelated);
    monitor.stop();
    monitor.stop();
    respond("/api/v1/spaces/x/categories", 502);
    expect(monitor.issues).toEqual([]);
    expect(context.listenerCount("request")).toBe(0);
    expect(context.listenerCount("requestfailed")).toBe(0);
    expect(context.listeners("response")).toEqual([unrelated]);
  });
});
