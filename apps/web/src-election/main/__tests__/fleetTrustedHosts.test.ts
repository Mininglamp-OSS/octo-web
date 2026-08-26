import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addFleetTrustedHost,
  normalizeTrustedHost,
  readFleetTrustedHosts,
  removeFleetTrustedHost,
  writeFleetTrustedHosts,
} from "../fleetTrustedHosts";

describe("normalizeTrustedHost", () => {
  it("accepts plain hostnames and host:port values", () => {
    expect(normalizeTrustedHost("example.com")).toBe("example.com");
    expect(normalizeTrustedHost(" Example.COM ")).toBe("example.com");
    expect(normalizeTrustedHost("onprem.example:8443")).toBe("onprem.example:8443");
  });

  it("normalizes an explicit default port away", () => {
    expect(normalizeTrustedHost("example.com:443")).toBe("example.com");
  });

  it("rejects non-host strings", () => {
    expect(normalizeTrustedHost("")).toBeNull();
    expect(normalizeTrustedHost("   ")).toBeNull();
    expect(normalizeTrustedHost("example.com/path")).toBeNull();
    expect(normalizeTrustedHost("example.com?x=1")).toBeNull();
    expect(normalizeTrustedHost("example.com#frag")).toBeNull();
    expect(normalizeTrustedHost("user:pass@example.com")).toBeNull();
    expect(normalizeTrustedHost("https://example.com")).toBeNull();
    expect(normalizeTrustedHost("not a host")).toBeNull();
    expect(normalizeTrustedHost(123 as unknown as string)).toBeNull();
  });
});

describe("fleetTrustedHosts store", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-trusted-hosts-"));
    filePath = path.join(dir, "fleet-trusted-hosts.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list for a missing or invalid file (fail closed)", () => {
    expect(readFleetTrustedHosts(filePath)).toEqual([]);
    fs.writeFileSync(filePath, "not json", "utf8");
    expect(readFleetTrustedHosts(filePath)).toEqual([]);
    fs.writeFileSync(filePath, JSON.stringify({ host: "example.com" }), "utf8");
    expect(readFleetTrustedHosts(filePath)).toEqual([]);
  });

  it("filters invalid entries while keeping valid hosts", () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify(["example.com", 42, null, "example.com/path", "onprem.example:8443"]),
      "utf8",
    );
    expect(readFleetTrustedHosts(filePath)).toEqual([
      "example.com",
      "onprem.example:8443",
    ]);
  });

  it("adds a host idempotently and persists canonically", () => {
    expect(addFleetTrustedHost(filePath, "Example.com")).toEqual(["example.com"]);
    expect(addFleetTrustedHost(filePath, "example.com")).toEqual(["example.com"]);
    expect(addFleetTrustedHost(filePath, "other.example")).toEqual([
      "example.com",
      "other.example",
    ]);
    expect(readFleetTrustedHosts(filePath)).toEqual(["example.com", "other.example"]);
  });

  it("rejects adding an invalid host", () => {
    expect(() => addFleetTrustedHost(filePath, "example.com/path")).toThrow();
  });

  it("removes exactly the requested host and keeps others", () => {
    addFleetTrustedHost(filePath, "example.com");
    addFleetTrustedHost(filePath, "onprem.example:8443");

    expect(removeFleetTrustedHost(filePath, "example.com")).toEqual([
      "onprem.example:8443",
    ]);
    expect(readFleetTrustedHosts(filePath)).toEqual(["onprem.example:8443"]);
  });

  it("keeps the port in the identity: removing the bare host does not remove the ported one", () => {
    addFleetTrustedHost(filePath, "onprem.example:8443");
    expect(removeFleetTrustedHost(filePath, "onprem.example")).toEqual([
      "onprem.example:8443",
    ]);
    expect(readFleetTrustedHosts(filePath)).toEqual(["onprem.example:8443"]);
  });

  it("removing an absent host is a no-op without rewriting the file", () => {
    addFleetTrustedHost(filePath, "example.com");
    const before = fs.statSync(filePath).mtimeMs;
    expect(removeFleetTrustedHost(filePath, "absent.example")).toEqual(["example.com"]);
    expect(fs.statSync(filePath).mtimeMs).toBe(before);
  });

  it("writes atomically and leaves no temp files behind", () => {
    writeFleetTrustedHosts(filePath, ["example.com", "example.com"]);
    expect(readFleetTrustedHosts(filePath)).toEqual(["example.com"]);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
