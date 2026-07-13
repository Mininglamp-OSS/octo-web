import { describe, expect, it } from "vitest";

import { headlessCommand, shellQuote } from "../headlessCommand";

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("mul_abc123")).toBe("'mul_abc123'");
    expect(shellQuote("http://localhost:3100")).toBe("'http://localhost:3100'");
  });

  it("escapes embedded single quotes so the value cannot break out of the quoting", () => {
    // POSIX close-quote, escaped literal quote, reopen-quote.
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe("headlessCommand", () => {
  it("builds a login + daemon-start command with both interpolations quoted", () => {
    expect(headlessCommand("mul_token", "http://localhost:3100")).toBe(
      "octo-daemon login --token 'mul_token' --server-url 'http://localhost:3100' && octo-daemon daemon start",
    );
  });

  it("neutralizes a malformed backend URL so it cannot inject extra shell commands", () => {
    const cmd = headlessCommand("mul_token", "http://x'; rm -rf ~; echo '");
    // The injected quote is escaped, keeping the whole value inside one argument.
    expect(cmd).toContain("--server-url 'http://x'\\''; rm -rf ~; echo '\\'''");
    // A bare, unquoted `rm -rf ~` must not appear as its own command token.
    expect(cmd).not.toMatch(/--server-url http:\/\/x'; rm -rf ~/);
  });
});
