import { describe, expect, it } from "vitest";
import { isLoopbackHost, isSafeCliCallback } from "../cliCallback";

// 安全回归锁:回调地址是 CLI token 的送达终点,只能是本机回环。
describe("isSafeCliCallback", () => {
  it("accepts loopback callbacks", () => {
    expect(isSafeCliCallback("http://localhost:52001/cb")).toBe(true);
    expect(isSafeCliCallback("http://127.0.0.1:52001/cb")).toBe(true);
    expect(isSafeCliCallback("http://127.1.2.3/cb")).toBe(true); // 127.0.0.0/8 全段
    expect(isSafeCliCallback("http://[::1]:52001/cb")).toBe(true); // IPv6 回环(带方括号)
    expect(isSafeCliCallback("https://localhost/cb")).toBe(true);
  });

  it("rejects LAN / private-network hosts (token exfil vector)", () => {
    expect(isSafeCliCallback("http://192.168.1.50:8080/cb")).toBe(false);
    expect(isSafeCliCallback("http://10.0.0.9/cb")).toBe(false);
    expect(isSafeCliCallback("http://172.16.0.1/cb")).toBe(false);
    expect(isSafeCliCallback("http://172.31.255.254/cb")).toBe(false);
  });

  it("rejects public hosts and IPs", () => {
    expect(isSafeCliCallback("http://evil.com/cb")).toBe(false);
    expect(isSafeCliCallback("https://1.2.3.4/cb")).toBe(false);
    expect(isSafeCliCallback("http://localhost.evil.com/cb")).toBe(false);
  });

  it("defeats the userinfo open-redirect trick (host resolves to attacker)", () => {
    expect(isSafeCliCallback("http://127.0.0.1@evil.com/cb")).toBe(false);
    expect(isSafeCliCallback("http://localhost@evil.com/cb")).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isSafeCliCallback("javascript:alert(1)")).toBe(false);
    expect(isSafeCliCallback("file:///etc/passwd")).toBe(false);
    expect(isSafeCliCallback("data:text/html,x")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isSafeCliCallback("not a url")).toBe(false);
    expect(isSafeCliCallback("")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("handles bracketed and bare IPv6 loopback", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::ffff:127.0.0.1]")).toBe(true);
  });

  it("rejects boundary private ranges just outside RFC1918-but-not-loopback", () => {
    expect(isLoopbackHost("172.15.0.1")).toBe(false);
    expect(isLoopbackHost("172.32.0.1")).toBe(false);
    expect(isLoopbackHost("128.0.0.1")).toBe(false);
  });
});
